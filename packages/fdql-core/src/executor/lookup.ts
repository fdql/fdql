import { createFdqlProviderAggregateCacheKey, createFdqlProviderReadCacheKey } from '../cache.ts';
import { type EvalContext, evaluateExpression } from '../evaluator.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  EvalRows,
  FdqlDiagnostic,
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlLookupPlanStage,
  FdqlProviderAggregateRequest,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlSingleReadPlan,
  FdqlStats,
  FdqlValue,
} from '../types.ts';
import { isMissingValue, mapValue, nullValue, numberValue } from '../value.ts';
import {
  aggregateProvider,
  createAggregateRequest,
  createReadRequest,
  providerDialects,
  readProvider,
} from './provider-read.ts';
import {
  freezeStats,
  providerReadControls,
  recordAggregateRead,
  recordRead,
  stopReasonFor,
} from './stats.ts';
import type { LookupCache, MutableStats, RowRecord } from './types.ts';

export async function executeLookup(
  stage: FdqlLookupPlanStage,
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
  readonly row: RowRecord | null;
  readonly stopReason?: NonNullable<FdqlStats['stoppedReason']> | undefined;
}> {
  if (stage.mode === 'aggregate') {
    return executeAggregateLookup(
      stage,
      plan,
      row,
      runtime,
      stats,
      options,
      startedAt,
      lookupCache,
    );
  }
  const remainingBudget = Math.max(0, plan.settings.readBudget - stats.reads);
  const lookupOneCap = stage.mode === 'one' && stage.provider.limit === undefined ? 2 : undefined;
  const boundProvider = bindProviderReadPlan(stage, row, runtime);
  if (boundProvider.kind === 'failed') {
    return { diagnostic: boundProvider.diagnostic, events: [], row };
  }
  if (boundProvider.kind === 'skip') return { events: [], row: lookupRow(stage, row, []) };
  const request = createReadRequest(
    boundProvider.provider,
    plan,
    stage.rowAlias,
    stats,
    'lookup',
    row as EvalRows,
    Math.min(remainingBudget, lookupOneCap ?? remainingBudget),
  );
  const beforeLookupStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (beforeLookupStop) return { events: [], row, stopReason: beforeLookupStop };
  if (lookupHasMissingCorrelatedValue(request, runtime)) {
    return { events: [], row: lookupRow(stage, row, []) };
  }
  const documents: FdqlProviderRow[] = [];
  const events: FdqlExecutionEvent[] = [];
  const cachePolicy = lookupCachePolicy(stage, plan, request, runtime, options);
  const cachedDocuments = cachePolicy.kind === 'run'
    ? lookupCache.get(cachePolicy.key.canonicalJson)
    : undefined;
  if (cachedDocuments) {
    stats.cacheHits += 1;
    return {
      events: [{ kind: 'stats', stats: freezeStats(stats) }],
      row: lookupRow(stage, row, cachedDocuments.slice(0, request.maxDocuments)),
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
        row: lookupRow(stage, row, hit.rows.slice(0, request.maxDocuments)),
      };
    }
  }
  if (cachePolicy.kind !== 'off') stats.cacheMisses += 1;

  for await (
    const document of readProvider(runtime, request, providerReadControls(plan, options, startedAt))
  ) {
    const beforeReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
    if (beforeReadStop) return { events, row, stopReason: beforeReadStop };
    events.push(recordRead(document, request, stats, true));
    documents.push(document);
    const stopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
    if (stopReason) return { events, row, stopReason };
  }
  const afterReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (afterReadStop) return { events, row, stopReason: afterReadStop };
  if (stage.mode === 'one' && documents.length > 1) {
    return {
      diagnostic: {
        code: 'FDQL_LOOKUP_ONE_TOO_MANY',
        line: stage.line,
        message:
          `lookup one ${stage.sourceAlias} as ${stage.rowAlias} returned more than one document.`,
        severity: 'error',
      },
      events,
      row,
    };
  }
  if (cachePolicy.kind === 'run') lookupCache.set(cachePolicy.key.canonicalJson, documents);
  if (
    cachePolicy.kind === 'persistent' && options.persistentCache
    && shouldPersistLookupRows(stage, request, documents)
  ) {
    const nowMs = options.now?.() ?? Date.now();
    const result = await options.persistentCache.set({
      expiresAtMs: nowMs + lookupCacheTtlMs(stage, plan),
      key: cachePolicy.key,
      nowMs,
      rows: documents,
    });
    stats.cacheWrites += 1;
    stats.cacheEvictions += result.evictedEntries;
    stats.cacheBytes += result.sizeBytes;
  }
  return {
    events,
    row: lookupRow(stage, row, documents),
  };
}

async function executeAggregateLookup(
  stage: FdqlLookupPlanStage,
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
  readonly row: RowRecord | null;
  readonly stopReason?: NonNullable<FdqlStats['stoppedReason']> | undefined;
}> {
  const aggregate = stage.aggregate;
  if (!aggregate) {
    return {
      diagnostic: {
        code: 'FDQL_INVALID_LOOKUP_AGGREGATE',
        line: stage.line,
        message: '`lookup aggregate` is missing aggregate plan data.',
        severity: 'error',
      },
      events: [],
      row,
    };
  }
  const boundProvider = bindProviderReadPlan(stage, row, runtime);
  if (boundProvider.kind === 'failed') {
    return { diagnostic: boundProvider.diagnostic, events: [], row };
  }
  const defaults = defaultAggregateValues(stage);
  if (boundProvider.kind === 'skip') {
    return { events: [], row: lookupAggregateRow(stage, row, defaults) };
  }
  const request = createAggregateRequest(
    boundProvider.provider,
    aggregate,
    plan,
    stats,
    row as EvalRows,
  );
  const beforeLookupStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (beforeLookupStop) return { events: [], row, stopReason: beforeLookupStop };
  if (lookupHasMissingCorrelatedValue(request, runtime)) {
    return { events: [], row: lookupAggregateRow(stage, row, defaults) };
  }

  const cachePolicy = aggregateLookupCachePolicy(stage, plan, request, runtime, options);
  const cachedRows = cachePolicy.kind === 'run'
    ? lookupCache.get(cachePolicy.key.canonicalJson)
    : undefined;
  if (cachedRows) {
    stats.cacheHits += 1;
    return {
      events: [{ kind: 'stats', stats: freezeStats(stats) }],
      row: lookupAggregateRow(stage, row, aggregateValuesFromCache(stage, cachedRows)),
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
        row: lookupAggregateRow(stage, row, aggregateValuesFromCache(stage, hit.rows)),
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
  if (afterReadStop) return { events, row, stopReason: afterReadStop };

  const values = { ...defaults, ...result.values };
  const cacheRows = aggregateRowsForCache(stage, request, values);
  if (cachePolicy.kind === 'run') lookupCache.set(cachePolicy.key.canonicalJson, cacheRows);
  if (cachePolicy.kind === 'persistent' && options.persistentCache) {
    const nowMs = options.now?.() ?? Date.now();
    const cacheResult = await options.persistentCache.set({
      expiresAtMs: nowMs + lookupCacheTtlMs(stage, plan),
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
    row: lookupAggregateRow(stage, row, values),
  };
}

function bindProviderReadPlan(
  stage: FdqlLookupPlanStage,
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
        code: 'FDQL_INVALID_LOOKUP_SOURCE',
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
    return {
      kind: 'bound',
      provider: { ...stage.provider, source: result.source },
    };
  }
  if (result.kind === 'failed') return result;
  return result;
}

function lookupCacheMode(
  stage: FdqlLookupPlanStage,
  plan: FdqlSingleReadPlan,
) {
  return stage.cache ?? plan.settings.cache;
}

function lookupCacheTtlMs(
  stage: FdqlLookupPlanStage,
  plan: FdqlSingleReadPlan,
): number {
  return stage.cacheTtlMs ?? plan.settings.cacheTtlMs;
}

function lookupCachePolicy(
  stage: FdqlLookupPlanStage,
  plan: FdqlSingleReadPlan,
  request: FdqlProviderReadRequest,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions,
):
  | {
    readonly key: ReturnType<typeof createFdqlProviderReadCacheKey>;
    readonly kind: 'persistent';
  }
  | { readonly key: ReturnType<typeof createFdqlProviderReadCacheKey>; readonly kind: 'run'; }
  | { readonly kind: 'off'; }
{
  const mode = lookupCacheMode(stage, plan);
  if (mode === 'off') return { kind: 'off' };
  const key = createFdqlProviderReadCacheKey({
    cacheContext: options.cacheContext,
    providers: providerDialects(runtime),
    readLimit: cacheReadLimit(stage, request),
    request,
  });
  return { key, kind: mode };
}

function aggregateLookupCachePolicy(
  stage: FdqlLookupPlanStage,
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
  const mode = lookupCacheMode(stage, plan);
  if (mode === 'off') return { kind: 'off' };
  const key = createFdqlProviderAggregateCacheKey({
    cacheContext: options.cacheContext,
    providers: providerDialects(runtime),
    request,
  });
  return { key, kind: mode };
}

function cacheReadLimit(
  stage: FdqlLookupPlanStage,
  request: FdqlProviderReadRequest,
): number | undefined {
  if (request.limit !== undefined) return request.limit;
  return stage.mode === 'one' ? request.maxDocuments : undefined;
}

function shouldPersistLookupRows(
  stage: FdqlLookupPlanStage,
  request: FdqlProviderReadRequest,
  documents: readonly FdqlProviderRow[],
): boolean {
  if (request.maxDocuments <= 0) return false;
  if (stage.mode === 'one') return documents.length <= 1;
  if (request.limit !== undefined) return true;
  return documents.length < request.maxDocuments;
}

function lookupRow(
  stage: FdqlLookupPlanStage,
  row: RowRecord,
  documents: readonly FdqlProviderRow[],
): RowRecord | null {
  if (stage.required && documents.length === 0) return null;
  return {
    ...row,
    [stage.rowAlias]: stage.mode === 'one' ? documents[0] ?? null : documents,
  };
}

function lookupAggregateRow(
  stage: FdqlLookupPlanStage,
  row: RowRecord,
  values: Readonly<Record<string, FdqlValue>>,
): RowRecord {
  return {
    ...row,
    [stage.rowAlias]: mapValue(values),
  };
}

function defaultAggregateValues(
  stage: FdqlLookupPlanStage,
): Readonly<Record<string, FdqlValue>> {
  return Object.fromEntries(
    (stage.aggregate?.items ?? []).map((item) => [
      item.alias,
      item.functionName.endsWith('.count') || item.functionName.endsWith('.sum')
        ? numberValue(0)
        : nullValue,
    ]),
  );
}

function aggregateRowsForCache(
  stage: FdqlLookupPlanStage,
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
  stage: FdqlLookupPlanStage,
  rows: readonly FdqlProviderRow[],
): Readonly<Record<string, FdqlValue>> {
  return { ...defaultAggregateValues(stage), ...rows[0]?.data };
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

function lookupHasMissingCorrelatedValue(
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
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
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
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
  if (expression.kind === 'unary') {
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
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
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
  if (expression.kind === 'unary') {
    return expressionContainsCorrelatedReference(expression.expression, request);
  }
  if (expression.kind === 'binary') {
    return expressionContainsCorrelatedReference(expression.left, request)
      || expressionContainsCorrelatedReference(expression.right, request);
  }
  return false;
}
