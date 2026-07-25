import { createFdqlProviderAggregateCacheKey } from '../cache.ts';
import type { EvalContext } from '../evaluator.ts';
import { evaluateExpression } from '../evaluator.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  EvalRows,
  FdqlDiagnostic,
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlLineageSource,
  FdqlProviderAggregatePlan,
  FdqlProviderAggregatePlanStage,
  FdqlProviderAggregateRequest,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlSingleReadPlan,
  FdqlStats,
  FdqlValue,
} from '../types.ts';
import { isMissingValue, mapValue, nullValue, numberValue } from '../value.ts';
import {
  aggregateLineageBindings,
  lineageSourceForProviderSource,
  lineageSourcesForRows,
} from './lineage.ts';
import { aggregateProvider, createAggregateRequest, providerDialects } from './provider-read.ts';
import {
  freezeStats,
  providerReadControls,
  recordAggregateRead,
  recordRead,
  stopReasonFor,
} from './stats.ts';
import type { LookupCache, MutableStats, RowRecord } from './types.ts';

export async function executeProviderAggregateStage(
  stage: FdqlProviderAggregatePlanStage,
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
  stats: MutableStats,
  options: FdqlExecutionOptions,
  startedAt: number,
  lookupCache: LookupCache,
): Promise<{
  readonly diagnostic?: Extract<FdqlExecutionEvent, { readonly kind: 'failed'; }>['diagnostic'];
  readonly events: readonly FdqlExecutionEvent[];
  readonly lineage: readonly {
    readonly binding: string;
    readonly sources: readonly FdqlLineageSource[];
  }[];
  readonly row: RowRecord | null;
  readonly stopReason?: NonNullable<FdqlStats['stoppedReason']> | undefined;
}> {
  const boundProvider = bindProviderReadPlan(stage, row, runtime);
  if (boundProvider.kind === 'failed') {
    return { diagnostic: boundProvider.diagnostic, events: [], lineage: [], row };
  }
  const defaults = defaultProviderAggregateValues(stage.aggregate);
  if (boundProvider.kind === 'skip') {
    return {
      events: [],
      lineage: aggregateLineageBindings(stage.aggregate, []),
      row: { ...row, ...providerAggregateOutputRow(stage.aggregate, defaults) },
    };
  }
  const request = createAggregateRequest(
    boundProvider.provider,
    stage.aggregate,
    plan,
    stats,
    row as EvalRows,
    'pipelineAggregate',
  );
  const beforeReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (beforeReadStop) return { events: [], lineage: [], row, stopReason: beforeReadStop };
  if (aggregateHasMissingCorrelatedValue(request, runtime)) {
    return {
      events: [],
      lineage: aggregateLineageBindings(stage.aggregate, []),
      row: { ...row, ...providerAggregateOutputRow(stage.aggregate, defaults) },
    };
  }

  const cachePolicy = aggregateCachePolicy(stage, plan, request, runtime, options);
  const cachedRows = cachePolicy.kind === 'run'
    ? lookupCache.get(cachePolicy.key.canonicalJson)
    : undefined;
  if (cachedRows) {
    stats.cacheHits += 1;
    return {
      events: [{ kind: 'stats', stats: freezeStats(stats) }],
      lineage: aggregateLineageBindings(
        stage.aggregate,
        lineageSourcesForRows(cachedRows, 'providerAggregate', 0),
      ),
      row: {
        ...row,
        ...providerAggregateOutputRow(
          stage.aggregate,
          aggregateValuesFromCache(stage.aggregate, cachedRows),
        ),
      },
    };
  }
  if (cachePolicy.kind === 'persistent' && options.persistentCache) {
    const nowMs = options.now?.() ?? Date.now();
    const hit = await options.persistentCache.get({ key: cachePolicy.key, nowMs });
    if (hit) {
      stats.cacheHits += 1;
      stats.cacheBytes += hit.sizeBytes;
      return {
        events: [{ kind: 'stats', stats: freezeStats(stats) }],
        lineage: aggregateLineageBindings(
          stage.aggregate,
          lineageSourcesForRows(hit.rows, 'providerAggregate', 0),
        ),
        row: {
          ...row,
          ...providerAggregateOutputRow(
            stage.aggregate,
            aggregateValuesFromCache(stage.aggregate, hit.rows),
          ),
        },
      };
    }
  }
  if (cachePolicy.kind !== 'off') stats.cacheMisses += 1;

  const result = await aggregateProvider(
    runtime,
    request,
    providerReadControls(plan, options, startedAt),
  );
  if (result.aggregateReads > 0) recordAggregateRead(request, stats, result.aggregateReads);
  const events = (result.documentReads ?? []).map((document) =>
    recordRead(document, readRequestForAggregate(request), stats, true)
  );
  const afterReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (afterReadStop) return { events, lineage: [], row, stopReason: afterReadStop };

  const values = { ...defaults, ...result.values };
  const cacheRows = aggregateRowsForCache(stage, request, values);
  const lineageSources = (result.documentReads?.length ?? 0) > 0
    ? lineageSourcesForRows(result.documentReads ?? [], 'providerAggregate')
    : [
      lineageSourceForProviderSource(
        request.source,
        'providerAggregate',
        result.aggregateReads,
      ),
    ];
  if (cachePolicy.kind === 'run') lookupCache.set(cachePolicy.key.canonicalJson, cacheRows);
  if (cachePolicy.kind === 'persistent' && options.persistentCache) {
    const nowMs = options.now?.() ?? Date.now();
    const cacheResult = await options.persistentCache.set({
      expiresAtMs: nowMs + aggregateCacheTtlMs(stage, plan),
      key: cachePolicy.key,
      nowMs,
      rows: cacheRows,
    });
    stats.cacheWrites += 1;
    stats.cacheEvictions += cacheResult.evictedEntries;
    stats.cacheBytes += cacheResult.sizeBytes;
  }
  return {
    events,
    lineage: aggregateLineageBindings(stage.aggregate, lineageSources),
    row: { ...row, ...providerAggregateOutputRow(stage.aggregate, values) },
  };
}

export function providerAggregateOutputRow(
  aggregate: FdqlProviderAggregatePlan,
  values: Readonly<Record<string, FdqlValue>>,
): RowRecord {
  const row: RowRecord = {};
  for (const output of aggregate.outputs) {
    if (output.kind === 'field') {
      row[output.alias] = values[output.itemAlias]
        ?? defaultValueForItem(aggregate, output.itemAlias);
      continue;
    }
    row[output.alias] = mapValue(
      Object.fromEntries(
        output.fields.map((field) => [
          field.alias,
          values[field.itemAlias] ?? defaultValueForItem(aggregate, field.itemAlias),
        ]),
      ),
    );
  }
  return row;
}

function bindProviderReadPlan(
  stage: FdqlProviderAggregatePlanStage,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
):
  | { readonly kind: 'bound'; readonly provider: typeof stage.provider; }
  | { readonly diagnostic: FdqlDiagnostic; readonly kind: 'failed'; }
  | { readonly kind: 'skip'; }
{
  const binding = stage.provider.binding;
  if (!binding) return { kind: 'bound', provider: stage.provider };
  const dialect = providerDialects(runtime)[stage.provider.source.provider];
  if (!dialect?.bindSource) {
    return {
      diagnostic: {
        code: 'FDQL_INVALID_PROVIDER_SOURCE',
        line: stage.line,
        message: `Provider ${stage.provider.source.provider} cannot bind parent sources.`,
        severity: 'error',
      },
      kind: 'failed',
    };
  }
  const result = dialect.bindSource({
    binding,
    context: {
      aliases: {},
      providers: providerDialects(runtime),
      rows: row as EvalRows,
    },
    line: stage.line,
    source: stage.provider.source,
  });
  if (result.kind === 'bound') {
    return { kind: 'bound', provider: { ...stage.provider, source: result.source } };
  }
  if (result.kind === 'failed') return result;
  return result;
}

function aggregateCachePolicy(
  stage: FdqlProviderAggregatePlanStage,
  plan: FdqlSingleReadPlan,
  request: FdqlProviderAggregateRequest,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions,
):
  | {
    readonly key: ReturnType<typeof createFdqlProviderAggregateCacheKey>;
    readonly kind: 'persistent';
  }
  | { readonly key: ReturnType<typeof createFdqlProviderAggregateCacheKey>; readonly kind: 'run'; }
  | { readonly kind: 'off'; }
{
  const mode = stage.cache ?? plan.settings.cache;
  if (mode === 'off') return { kind: 'off' };
  const key = createFdqlProviderAggregateCacheKey({
    cacheContext: options.cacheContext,
    providers: providerDialects(runtime),
    request,
  });
  return { key, kind: mode };
}

function aggregateCacheTtlMs(
  stage: FdqlProviderAggregatePlanStage,
  plan: FdqlSingleReadPlan,
): number {
  return stage.cacheTtlMs ?? plan.settings.cacheTtlMs;
}

function defaultProviderAggregateValues(
  aggregate: FdqlProviderAggregatePlan,
): Readonly<Record<string, FdqlValue>> {
  return Object.fromEntries(
    aggregate.items.map((item) => [
      item.alias,
      item.functionName.endsWith('.count') || item.functionName.endsWith('.sum')
        ? numberValue(0)
        : nullValue,
    ]),
  );
}

function defaultValueForItem(
  aggregate: FdqlProviderAggregatePlan,
  itemAlias: string,
): FdqlValue {
  const item = aggregate.items.find((candidate) => candidate.alias === itemAlias);
  return item?.functionName.endsWith('.count') || item?.functionName.endsWith('.sum')
    ? numberValue(0)
    : nullValue;
}

function aggregateRowsForCache(
  stage: FdqlProviderAggregatePlanStage,
  request: FdqlProviderAggregateRequest,
  values: Readonly<Record<string, FdqlValue>>,
): readonly FdqlProviderRow[] {
  return [{
    context: {},
    data: values,
    id: '__aggregate__',
    path: '',
    provider: request.source.provider,
    source: {
      ...request.source,
      sourceAlias: `${stage.sourceAlias}:aggregate`,
    },
  }];
}

function aggregateValuesFromCache(
  aggregate: FdqlProviderAggregatePlan,
  rows: readonly FdqlProviderRow[],
): Readonly<Record<string, FdqlValue>> {
  return { ...defaultProviderAggregateValues(aggregate), ...rows[0]?.data };
}

function readRequestForAggregate(
  request: FdqlProviderAggregateRequest,
): FdqlProviderReadRequest {
  return {
    aliases: request.aliases,
    maxDocuments: request.maxDocuments,
    pageSize: request.maxDocuments,
    ...(request.predicate ? { predicate: request.predicate } : {}),
    rowAlias: request.rowAlias,
    ...(request.rows ? { rows: request.rows } : {}),
    source: request.source,
    stage: 'lookup',
  };
}

function aggregateHasMissingCorrelatedValue(
  request: FdqlProviderAggregateRequest,
  runtime: FdqlProviderRuntimeRegistry,
): boolean {
  if (!request.predicate || !request.rows) return false;
  const context = {
    aliases: request.aliases,
    providers: providerDialects(runtime),
    rows: request.rows,
  } satisfies EvalContext;
  return expressionHasMissingCorrelatedValue(request.predicate, request, context);
}

function expressionHasMissingCorrelatedValue(
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest,
  context: EvalContext,
): boolean {
  if (expression.kind === 'field') {
    const head = expression.path[0];
    if (head && head !== request.rowAlias && Object.hasOwn(request.rows ?? {}, head)) {
      return isMissingValue(evaluateExpression(expression, context));
    }
    return false;
  }
  if (expression.kind === 'call') {
    const hasMissingArg = expression.args.some((arg) =>
      expressionHasMissingCorrelatedValue(arg, request, context)
    );
    return hasMissingArg
      || (expressionContainsCorrelatedReference(expression, request)
        && isMissingValue(evaluateExpression(expression, context)));
  }
  if (expression.kind === 'array') {
    return expression.items.some((item) =>
      expressionHasMissingCorrelatedValue(item, request, context)
    );
  }
  if (expression.kind === 'map') {
    return expression.entries.some((entry) =>
      expressionHasMissingCorrelatedValue(entry.value, request, context)
    );
  }
  if (expression.kind === 'case') {
    return expression.branches.some((branch) =>
      expressionHasMissingCorrelatedValue(branch.condition, request, context)
      || expressionHasMissingCorrelatedValue(branch.value, request, context)
    )
      || Boolean(
        expression.elseExpression
          && expressionHasMissingCorrelatedValue(expression.elseExpression, request, context),
      );
  }
  if (expression.kind === 'unary') {
    return expressionHasMissingCorrelatedValue(expression.expression, request, context);
  }
  if (expression.kind === 'postfix') {
    return expressionHasMissingCorrelatedValue(expression.expression, request, context);
  }
  if (expression.kind === 'binary') {
    return expressionHasMissingCorrelatedValue(expression.left, request, context)
      || expressionHasMissingCorrelatedValue(expression.right, request, context);
  }
  return false;
}

function expressionContainsCorrelatedReference(
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest,
): boolean {
  if (!request.rows) return false;
  if (expression.kind === 'field') {
    const head = expression.path[0];
    return Boolean(head && head !== request.rowAlias && Object.hasOwn(request.rows, head));
  }
  if (expression.kind === 'call') {
    return expression.args.some((arg) => expressionContainsCorrelatedReference(arg, request));
  }
  if (expression.kind === 'array') {
    return expression.items.some((item) => expressionContainsCorrelatedReference(item, request));
  }
  if (expression.kind === 'map') {
    return expression.entries.some((entry) =>
      expressionContainsCorrelatedReference(entry.value, request)
    );
  }
  if (expression.kind === 'case') {
    return expression.branches.some((branch) =>
      expressionContainsCorrelatedReference(branch.condition, request)
      || expressionContainsCorrelatedReference(branch.value, request)
    )
      || Boolean(
        expression.elseExpression
          && expressionContainsCorrelatedReference(expression.elseExpression, request),
      );
  }
  if (expression.kind === 'unary') {
    return expressionContainsCorrelatedReference(expression.expression, request);
  }
  if (expression.kind === 'postfix') {
    return expressionContainsCorrelatedReference(expression.expression, request);
  }
  if (expression.kind === 'binary') {
    return expressionContainsCorrelatedReference(expression.left, request)
      || expressionContainsCorrelatedReference(expression.right, request);
  }
  return false;
}
