import { createFdqlProviderReadCacheKey } from './cache.ts';
import { type EvalContext, evaluateExpression, truthy } from './evaluator.ts';
import {
  type FdqlProviderDialectRegistry,
  type FdqlProviderRuntimeRegistry,
  providerKey,
} from './provider.ts';
import type {
  EvalRows,
  FdqlAggregateStage,
  FdqlCacheMode,
  FdqlDiagnostic,
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlFilterStage,
  FdqlLookupPlanStage,
  FdqlProjectionItem,
  FdqlProviderReadPlan,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlReadPlan,
  FdqlSingleReadPlan,
  FdqlSortByStage,
  FdqlStats,
  FdqlTakeStage,
  FdqlUnwindStage,
  FdqlValue,
} from './types.ts';
import {
  arrayValue,
  compareValues,
  groupKey,
  isMissingValue,
  isNullValue,
  mapValue,
  nullValue,
  numberValue,
  numericValue,
  outputValue,
  toFdqlValue,
} from './value.ts';

export async function* executeFdql(
  plan: FdqlReadPlan,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions = {},
): AsyncIterable<FdqlExecutionEvent> {
  const startedAt = options.now?.() ?? Date.now();
  const stats = createStats(plan.settings.readBudget);
  const lookupCache: LookupCache = new Map();
  yield { kind: 'started' };

  try {
    if (plan.kind === 'union') {
      for (const [index, branch] of plan.branches.entries()) {
        stats.unionBranches += 1;
        const result = yield* executeReadBranch(
          branch,
          runtime,
          options,
          stats,
          startedAt,
          lookupCache,
          index,
        );
        if (result === 'stopped') return;
      }
    } else {
      const result = yield* executeReadBranch(
        plan,
        runtime,
        options,
        stats,
        startedAt,
        lookupCache,
      );
      if (result === 'stopped') return;
    }
    stats.stoppedReason = 'completed';
    yield { kind: 'completed', stats: freezeStats(stats) };
  } catch (error) {
    yield {
      diagnostic: diagnosticFromError(error),
      kind: 'failed',
    };
  }
}

function diagnosticFromError(error: unknown): FdqlDiagnostic {
  const location: { readonly column?: unknown; readonly line?: unknown; } = error instanceof Error
    ? error as Error & { readonly column?: unknown; readonly line?: unknown; }
    : {};
  return {
    code: 'FDQL_EXECUTION_FAILED',
    ...(typeof location.column === 'number' ? { column: location.column } : {}),
    ...(typeof location.line === 'number' ? { line: location.line } : {}),
    message: error instanceof Error ? error.message : String(error),
    severity: 'error',
  };
}

async function* executeReadBranch(
  plan: FdqlSingleReadPlan,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions,
  stats: MutableStats,
  startedAt: number,
  lookupCache: LookupCache,
  unionBranch?: number | undefined,
): AsyncGenerator<FdqlExecutionEvent, 'done' | 'stopped', unknown> {
  const request = createReadRequest(plan.provider, plan, plan.rowAlias, stats);
  const sourceRows: RowRecord[] = [];
  const sourceLineage = new WeakMap<RowRecord, FdqlProviderRow>();
  let readStopReason: NonNullable<FdqlStats['stoppedReason']> | undefined;

  for await (const document of readProvider(runtime, request)) {
    yield recordRead(document, request, stats, false);
    const beforeRowStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
    if (beforeRowStop) {
      stats.stoppedReason = beforeRowStop;
      for (const event of stopEvents(stats, beforeRowStop)) yield event;
      return 'stopped';
    }
    const row = { [plan.rowAlias]: document };
    sourceRows.push(row);
    sourceLineage.set(row, document);
    if (stats.reads >= plan.settings.readBudget) {
      readStopReason = 'budget';
      break;
    }
  }

  const localResult = yield* applyLocalStages(
    plan,
    sourceRows,
    sourceLineage,
    runtime,
    stats,
    startedAt,
    options,
    lookupCache,
  );
  if (localResult.kind === 'failed') {
    yield { diagnostic: localResult.diagnostic, kind: 'failed' };
    return 'stopped';
  }
  if (localResult.kind === 'stopped') {
    stats.stoppedReason = localResult.reason;
    for (const event of stopEvents(stats, localResult.reason)) yield event;
    return 'stopped';
  }

  for (const row of localResult.rows) {
    const document = localResult.lineage.get(row)
      ?? sourceRows.flatMap((item) => sourceLineage.get(item) ? [sourceLineage.get(item)!] : [])[0];
    const projected = projectItems(plan.returnStage.items, plan, row, runtime, 'external');
    stats.rowsOutput += 1;
    yield {
      kind: 'row',
      lineage: {
        provider: document?.provider ?? plan.provider.source.provider,
        rowPath: document?.path ?? '',
        readContribution: 1,
        source: unionBranch === undefined
          ? plan.provider.source.sourceAlias
          : `${plan.provider.source.sourceAlias}#${unionBranch + 1}`,
      },
      row: projected,
    };
    yield { kind: 'stats', stats: freezeStats(stats) };
    const rowStopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
    if (rowStopReason && rowStopReason !== 'budget') {
      stats.stoppedReason = rowStopReason;
      for (const event of stopEvents(stats, rowStopReason)) yield event;
      return 'stopped';
    }
  }

  if (readStopReason) {
    stats.stoppedReason = readStopReason;
    for (const event of stopEvents(stats, readStopReason)) yield event;
    return 'stopped';
  }
  return 'done';
}

function createReadRequest(
  provider: FdqlProviderReadPlan,
  plan: FdqlSingleReadPlan,
  rowAlias: string,
  stats: MutableStats,
  rows?: EvalRows,
  maxOverride?: number,
): FdqlProviderReadRequest {
  const source = provider.source;
  const remainingBudget = Math.max(0, plan.settings.readBudget - stats.reads);
  const maxDocuments = Math.min(
    provider.limit ?? remainingBudget,
    remainingBudget,
    maxOverride ?? remainingBudget,
  );
  return {
    aliases: plan.aliases,
    ...(provider.fieldMask ? { fieldMask: provider.fieldMask } : {}),
    ...(provider.limit === undefined ? {} : { limit: provider.limit }),
    maxDocuments,
    ...(provider.orderBy ? { orderBy: provider.orderBy } : {}),
    pageSize: Math.min(plan.settings.pageSize, maxDocuments),
    ...(provider.predicate ? { predicate: provider.predicate } : {}),
    rowAlias,
    ...(rows ? { rows } : {}),
    source,
  };
}

function recordRead(
  document: FdqlProviderRow,
  request: FdqlProviderReadRequest,
  stats: MutableStats,
  lookup: boolean,
): Extract<FdqlExecutionEvent, { readonly kind: 'read'; }> {
  stats.reads += 1;
  if (lookup) stats.lookupReads += 1;
  stats.rowsScanned += 1;
  const key = providerKey(document.provider, String(document.context.projectId ?? ''));
  stats.providerReads[key] = (stats.providerReads[key] ?? 0) + 1;
  return {
    count: 1,
    kind: 'read',
    provider: document.provider,
    source: request.source.sourceAlias,
  };
}

function createStats(readBudget: number): MutableStats {
  return {
    aggregateSourceRows: 0,
    cacheBytes: 0,
    cacheEvictions: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheWrites: 0,
    lookupReads: 0,
    providerReads: {},
    readBudget,
    reads: 0,
    rowsOutput: 0,
    rowsScanned: 0,
    unionBranches: 0,
  };
}

function stopReasonFor(
  plan: FdqlReadPlan,
  stats: MutableStats,
  startedAt: number,
  options: FdqlExecutionOptions,
  phase: 'afterRow' | 'beforeRow',
): FdqlStats['stoppedReason'] {
  if (options.signal?.aborted) return 'cancelled';
  const now = options.now?.() ?? Date.now();
  if (now - startedAt >= plan.settings.timeoutMs) return 'timeout';
  if (phase === 'afterRow' && stats.reads >= plan.settings.readBudget) return 'budget';
  return undefined;
}

function stopEvents(
  stats: MutableStats,
  stopReason: NonNullable<FdqlStats['stoppedReason']>,
): readonly FdqlExecutionEvent[] {
  const frozen = freezeStats(stats);
  return [
    { kind: 'stats', stats: frozen },
    stopReason === 'cancelled'
      ? { kind: 'cancelled', stats: frozen }
      : { kind: 'completed', stats: frozen },
  ];
}

function contextFor(
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
): EvalContext {
  return {
    aliases: plan.aliases,
    providers: providerDialects(runtime),
    rows: row as EvalRows,
  };
}

async function* applyLocalStages(
  plan: FdqlSingleReadPlan,
  sourceRows: readonly RowRecord[],
  sourceLineage: WeakMap<RowRecord, FdqlProviderRow>,
  runtime: FdqlProviderRuntimeRegistry,
  stats: MutableStats,
  startedAt: number,
  options: FdqlExecutionOptions,
  lookupCache: LookupCache,
): AsyncGenerator<
  FdqlExecutionEvent,
  | { readonly kind: 'failed'; readonly diagnostic: FdqlDiagnostic; }
  | {
    readonly kind: 'rows';
    readonly lineage: WeakMap<RowRecord, FdqlProviderRow>;
    readonly rows: readonly RowRecord[];
  }
  | { readonly kind: 'stopped'; readonly reason: NonNullable<FdqlStats['stoppedReason']>; },
  unknown
> {
  let rows = [...sourceRows];
  let lineage = sourceLineage;
  const takeCounts = new Map<number, number>();

  // oxlint-disable no-await-in-loop -- Local stages are ordered and lookup depends on current row values.
  for (const stage of plan.localStages) {
    if (stage.kind === 'filter') {
      rows = filterRows(stage, plan, rows, runtime);
    } else if (stage.kind === 'lookup') {
      const nextRows: RowRecord[] = [];
      const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
      for (const row of rows) {
        const lookup = await executeLookup(
          stage,
          plan,
          row,
          runtime,
          stats,
          startedAt,
          options,
          lookupCache,
        );
        for (const event of lookup.events) yield event;
        if (lookup.diagnostic) return { diagnostic: lookup.diagnostic, kind: 'failed' };
        if (lookup.stopReason) return { kind: 'stopped', reason: lookup.stopReason };
        if (lookup.row) {
          nextRows.push(lookup.row);
          copyLineage(lineage, nextLineage, row, lookup.row);
        }
      }
      rows = nextRows;
      lineage = nextLineage;
    } else if (stage.kind === 'sortBy') {
      rows = sortRows(stage, plan, rows, runtime);
    } else if (stage.kind === 'unwind') {
      const nextRows: RowRecord[] = [];
      const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
      for (const row of rows) {
        for (const unwound of unwindRow(stage, plan, row, runtime)) {
          nextRows.push(unwound);
          copyLineage(lineage, nextLineage, row, unwound);
        }
      }
      rows = nextRows;
      lineage = nextLineage;
    } else if (stage.kind === 'with') {
      const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
      rows = rows.map((row) => {
        const projected = projectItems(stage.items, plan, row, runtime, 'internal');
        copyLineage(lineage, nextLineage, row, projected);
        return projected;
      });
      lineage = nextLineage;
    } else if (stage.kind === 'aggregate') {
      const aggregated = aggregateRows(stage, plan, rows, lineage, stats, runtime);
      rows = aggregated.rows;
      lineage = aggregated.lineage;
    } else if (stage.kind === 'take') {
      rows = takeRows(stage, rows, takeCounts);
    }
    if (rows.length === 0) break;
  }
  // oxlint-enable no-await-in-loop

  return { kind: 'rows', lineage, rows };
}

function filterRows(
  stage: FdqlFilterStage,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  runtime: FdqlProviderRuntimeRegistry,
): RowRecord[] {
  return rows.filter((row) =>
    truthy(evaluateExpression(stage.expression, contextFor(plan, row, runtime)))
  );
}

function sortRows(
  stage: FdqlSortByStage,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  runtime: FdqlProviderRuntimeRegistry,
): RowRecord[] {
  const direction = stage.direction === 'desc' ? -1 : 1;
  const sorted: RowRecord[] = [];
  for (const row of rows) {
    const index = sorted.findIndex((candidate) =>
      compareValues(
            evaluateExpression(stage.expression, contextFor(plan, row, runtime)),
            evaluateExpression(stage.expression, contextFor(plan, candidate, runtime)),
          ) * direction < 0
    );
    if (index < 0) sorted.push(row);
    else sorted.splice(index, 0, row);
  }
  return sorted;
}

function takeRows(
  stage: FdqlTakeStage,
  rows: readonly RowRecord[],
  takeCounts: Map<number, number>,
): RowRecord[] {
  const taken = takeCounts.get(stage.line) ?? 0;
  const remaining = Math.max(0, stage.value - taken);
  const selected = rows.slice(0, remaining);
  takeCounts.set(stage.line, taken + selected.length);
  return selected;
}

function unwindRow(
  stage: FdqlUnwindStage,
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
): RowRecord[] {
  const value = evaluateExpression(stage.expression, contextFor(plan, row, runtime));
  return unwindItems(value).map((item) => ({ ...row, [stage.rowAlias]: item }));
}

function aggregateRows(
  stage: FdqlAggregateStage,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  lineage: WeakMap<RowRecord, FdqlProviderRow>,
  stats: MutableStats,
  runtime: FdqlProviderRuntimeRegistry,
): { readonly lineage: WeakMap<RowRecord, FdqlProviderRow>; readonly rows: RowRecord[]; } {
  stats.aggregateSourceRows += rows.length;
  const groups = new Map<
    string,
    { readonly keyValues: readonly FdqlValue[]; readonly rows: RowRecord[]; }
  >();
  for (const row of rows) {
    const keyValues = stage.groups.map((group) =>
      evaluateExpression(group.expression, contextFor(plan, row, runtime))
    );
    const key = keyValues.map(groupKey).join('\u001f');
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { keyValues, rows: [row] });
  }

  const nextRows: RowRecord[] = [];
  const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
  for (const group of groups.values()) {
    const output: RowRecord = {};
    for (const [index, item] of stage.groups.entries()) {
      output[item.alias ?? item.label] = group.keyValues[index];
    }
    for (const item of stage.items) {
      output[item.alias ?? item.label] = aggregateValue(item.expression, plan, group.rows, runtime);
    }
    nextRows.push(output);
    const source = group.rows.flatMap((row) => lineage.get(row) ? [lineage.get(row)!] : [])[0];
    if (source) nextLineage.set(output, source);
  }
  return { lineage: nextLineage, rows: nextRows };
}

function aggregateValue(
  expression: FdqlExpression,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  runtime: FdqlProviderRuntimeRegistry,
): FdqlValue {
  if (expression.kind !== 'call') return nullValue;
  if (expression.name === 'count') return numberValue(rows.length);
  const values = rows.map((row) =>
    evaluateExpression(expression.args[0]!, contextFor(plan, row, runtime))
  )
    .filter((value) => !isNullValue(value) && !isMissingValue(value));
  if (expression.name === 'sum') {
    return numberValue(values.reduce<number>((total, value) => total + numericValue(value), 0));
  }
  if (expression.name === 'avg') {
    return values.length
      ? numberValue(
        values.reduce<number>((total, value) => total + numericValue(value), 0) / values.length,
      )
      : nullValue;
  }
  if (expression.name === 'min') return minMax(values, 'min');
  if (expression.name === 'max') return minMax(values, 'max');
  return nullValue;
}

function minMax(values: readonly FdqlValue[], mode: 'max' | 'min'): FdqlValue {
  let selected: FdqlValue | undefined;
  for (const value of values) {
    const direction = mode === 'max' ? 1 : -1;
    if (selected === undefined || compareValues(value, selected) * direction > 0) {
      selected = value;
    }
  }
  return selected ?? nullValue;
}

function copyLineage(
  from: WeakMap<RowRecord, FdqlProviderRow>,
  to: WeakMap<RowRecord, FdqlProviderRow>,
  oldRow: RowRecord,
  newRow: RowRecord,
): void {
  const source = from.get(oldRow);
  if (source) to.set(newRow, source);
}

function unwindItems(value: FdqlValue): readonly FdqlValue[] {
  if (value.kind === 'array') return value.value;
  if (value.kind === 'map') return Object.values(value.value);
  return [];
}

async function executeLookup(
  stage: FdqlLookupPlanStage,
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
  stats: MutableStats,
  startedAt: number,
  options: FdqlExecutionOptions,
  lookupCache: LookupCache,
): Promise<{
  readonly diagnostic?: Extract<FdqlExecutionEvent, { readonly kind: 'failed'; }>['diagnostic'];
  readonly events: readonly FdqlExecutionEvent[];
  readonly row: RowRecord | null;
  readonly stopReason?: NonNullable<FdqlStats['stoppedReason']> | undefined;
}> {
  const remainingBudget = Math.max(0, plan.settings.readBudget - stats.reads);
  const lookupOneCap = stage.mode === 'one' && stage.provider.limit === undefined ? 2 : undefined;
  const request = createReadRequest(
    stage.provider,
    plan,
    stage.rowAlias,
    stats,
    row as EvalRows,
    Math.min(remainingBudget, lookupOneCap ?? remainingBudget),
  );
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

  for await (const document of readProvider(runtime, request)) {
    events.push(recordRead(document, request, stats, true));
    documents.push(document);
    const stopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
    if (stopReason) return { events, row, stopReason };
  }
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

function lookupCacheMode(
  stage: FdqlLookupPlanStage,
  plan: FdqlSingleReadPlan,
): FdqlCacheMode {
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
  if (expression.kind === 'unary') {
    return expressionContainsCorrelatedReference(expression.expression, request);
  }
  if (expression.kind === 'binary') {
    return expressionContainsCorrelatedReference(expression.left, request)
      || expressionContainsCorrelatedReference(expression.right, request);
  }
  return false;
}

function projectItems(
  items: readonly FdqlProjectionItem[],
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
  mode: 'external' | 'internal',
): RowRecord {
  const projected: RowRecord = {};
  for (const item of items) {
    if (item.expression.kind === 'wildcard') {
      Object.assign(projected, expandWildcard(row, mode));
      continue;
    }
    const value = evaluateExpression(
      item.expression,
      contextFor(plan, row, runtime),
    );
    const key = item.alias ?? labelFor(item.expression, item.label);
    if (mode === 'internal') {
      projected[key] = value;
      continue;
    }
    const output = outputValue(value);
    if (output !== undefined) projected[key] = output;
  }
  return projected;
}

function expandWildcard(
  row: Record<string, unknown>,
  mode: 'external' | 'internal',
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).flatMap(([key, value]) => {
      const next = mode === 'internal' ? internalRowValue(value) : externalRowValue(value);
      return next === undefined ? [] : [[key, next]];
    }),
  );
}

function labelFor(expression: FdqlExpression, fallback: string): string {
  if (expression.kind === 'field') return expression.path.at(-1) ?? fallback;
  if (expression.kind === 'call') return expression.name.split('.').at(-1) ?? fallback;
  return fallback;
}

async function* readProvider(
  runtime: FdqlProviderRuntimeRegistry,
  request: FdqlProviderReadRequest,
): AsyncIterable<FdqlProviderRow> {
  const provider = runtime.providers[request.source.provider];
  if (!provider) {
    throw new Error(`No runtime registered for provider ${request.source.provider}.`);
  }
  yield* provider.read(request);
}

function providerDialects(runtime: FdqlProviderRuntimeRegistry): FdqlProviderDialectRegistry {
  return runtime.dialects ?? {};
}

function freezeStats(stats: MutableStats): FdqlStats {
  return {
    aggregateSourceRows: stats.aggregateSourceRows,
    cacheBytes: stats.cacheBytes,
    cacheEvictions: stats.cacheEvictions,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    cacheWrites: stats.cacheWrites,
    lookupReads: stats.lookupReads,
    providerReads: { ...stats.providerReads },
    readBudget: stats.readBudget,
    reads: stats.reads,
    rowsOutput: stats.rowsOutput,
    rowsScanned: stats.rowsScanned,
    ...(stats.stoppedReason ? { stoppedReason: stats.stoppedReason } : {}),
    unionBranches: stats.unionBranches,
  };
}

function isDocument(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'data' in value
    && 'id' in value
    && 'provider' in value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && !Array.isArray(value)
    && !isDocument(value);
}

function internalRowValue(value: unknown): unknown {
  if (isDocument(value)) return mapValue(value.data);
  if (Array.isArray(value)) {
    return arrayValue(
      value.map((item) => isDocument(item) ? mapValue(item.data) : toFdqlValue(item)),
    );
  }
  if (isPlainRecord(value)) return mapValue(value as Record<string, FdqlValue>);
  return value;
}

function externalRowValue(value: unknown): unknown {
  if (isDocument(value)) return outputValue(mapValue(value.data));
  if (Array.isArray(value)) {
    return outputValue(
      arrayValue(value.map((item) => isDocument(item) ? mapValue(item.data) : toFdqlValue(item))),
    );
  }
  if (isPlainRecord(value)) return outputValue(mapValue(value as Record<string, FdqlValue>));
  if (value === null) return null;
  if (isFdqlValue(value)) return outputValue(value);
  return value;
}

function isFdqlValue(value: unknown): value is FdqlValue {
  return value !== null && typeof value === 'object' && 'kind' in value;
}

type RowRecord = Record<string, unknown>;

type LookupCache = Map<string, readonly FdqlProviderRow[]>;

type MutableStats = {
  -readonly [Key in keyof FdqlStats]: Key extends 'providerReads' ? Record<string, number>
    : FdqlStats[Key];
};
