import { createFdqlProviderReadCacheKey } from '../cache.ts';
import { type EvalContext, evaluateExpression } from '../evaluator.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  EvalRows,
  FdqlDiagnostic,
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlLineageSource,
  FdqlLookupPlanStage,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlSingleReadPlan,
  FdqlStats,
} from '../types.ts';
import { isMissingValue } from '../value.ts';
import { lineageSourcesForRows } from './lineage.ts';
import { createReadRequest, providerDialects, readProvider } from './provider-read.ts';
import { freezeStats, providerReadControls, recordRead, stopReasonFor } from './stats.ts';
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
  readonly lineage?: {
    readonly binding: string;
    readonly sources: readonly FdqlLineageSource[];
  } | undefined;
  readonly row: RowRecord | null;
  readonly stopReason?: NonNullable<FdqlStats['stoppedReason']> | undefined;
}> {
  const remainingBudget = Math.max(0, plan.settings.readBudget - stats.reads);
  const lookupOneCap = stage.mode === 'one' && stage.provider.limit === undefined ? 2 : undefined;
  const boundProvider = bindProviderReadPlan(stage, row, runtime);
  if (boundProvider.kind === 'failed') {
    return { diagnostic: boundProvider.diagnostic, events: [], row };
  }
  if (boundProvider.kind === 'skip') {
    return {
      events: [],
      lineage: lookupLineage(stage, []),
      row: lookupRow(stage, row, []),
    };
  }
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
    return {
      events: [],
      lineage: lookupLineage(stage, []),
      row: lookupRow(stage, row, []),
    };
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
      lineage: lookupLineage(stage, cachedDocuments),
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
        lineage: lookupLineage(stage, hit.rows),
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
    lineage: lookupLineage(stage, documents),
    row: lookupRow(stage, row, documents),
  };
}

function lookupLineage(
  stage: FdqlLookupPlanStage,
  documents: readonly FdqlProviderRow[],
): {
  readonly binding: string;
  readonly sources: readonly FdqlLineageSource[];
} {
  return {
    binding: stage.rowAlias,
    sources: lineageSourcesForRows(documents, 'lookup'),
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

function lookupHasMissingCorrelatedValue(
  request: FdqlProviderReadRequest,
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
  request: FdqlProviderReadRequest,
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
  request: FdqlProviderReadRequest,
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
