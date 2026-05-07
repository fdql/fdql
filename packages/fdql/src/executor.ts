import { type EvalContext, evaluateExpression, truthy } from './evaluator.ts';
import { firestoreProviderDialect } from './fs-dialect.ts';
import {
  createProviderDialectRegistry,
  type FdqlProviderDialectRegistry,
  type FdqlProviderRuntimeRegistry,
  providerKey,
} from './provider.ts';
import type {
  EvalRows,
  FdqlAggregateStage,
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
  InMemoryFdqlRuntimeInput,
} from './types.ts';

export async function* executeFdql(
  plan: FdqlReadPlan,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions = {},
): AsyncIterable<FdqlExecutionEvent> {
  const startedAt = options.now?.() ?? Date.now();
  const stats = createStats(plan.settings.readBudget);
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
          index,
        );
        if (result === 'stopped') return;
      }
    } else {
      const result = yield* executeReadBranch(plan, runtime, options, stats, startedAt);
      if (result === 'stopped') return;
    }
    stats.stoppedReason = 'completed';
    yield { kind: 'completed', stats: freezeStats(stats) };
  } catch (error) {
    yield {
      diagnostic: {
        code: 'FDQL_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
      },
      kind: 'failed',
    };
  }
}

async function* executeReadBranch(
  plan: FdqlSingleReadPlan,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions,
  stats: MutableStats,
  startedAt: number,
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
    const projected = projectItems(plan.returnStage.items, plan, row, runtime);
    stats.rowsOutput += 1;
    yield {
      kind: 'row',
      lineage: {
        documentPath: document?.path ?? '',
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

export function createInMemoryFdqlRuntime(
  input: InMemoryFdqlRuntimeInput,
): FdqlProviderRuntimeRegistry {
  return {
    dialects: createProviderDialectRegistry([firestoreProviderDialect]),
    providers: {
      fs: {
        async *read(request) {
          const projectId = String(request.source.target.projectId ?? '');
          const project = input.projects[projectId] ?? {};
          const documents = readDocuments(project, request);
          const filtered = documents.filter((document) =>
            !request.predicate
            || truthy(evaluateExpression(request.predicate, {
              aliases: request.aliases,
              providers: { fs: firestoreProviderDialect },
              rows: { ...request.rows, [request.rowAlias]: document },
            }))
          );
          const ordered = orderDocuments(filtered, request);
          const limited = ordered.slice(0, request.maxDocuments);
          for (const document of limited) {
            yield applyFieldMask(document, request);
          }
        },
      },
    },
  };
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
    cacheHits: 0,
    cacheMisses: 0,
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
        const lookup = await executeLookup(stage, plan, row, runtime, stats, startedAt, options);
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
        const projected = projectItems(stage.items, plan, row, runtime);
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
    { readonly keyValues: readonly unknown[]; readonly rows: RowRecord[]; }
  >();
  for (const row of rows) {
    const keyValues = stage.groups.map((group) =>
      evaluateExpression(group.expression, contextFor(plan, row, runtime))
    );
    const key = JSON.stringify(keyValues.map(groupKeyPart));
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
): unknown {
  if (expression.kind !== 'call') return null;
  if (expression.name === 'count') return rows.length;
  const values = rows.map((row) =>
    evaluateExpression(expression.args[0]!, contextFor(plan, row, runtime))
  )
    .filter((value) => value !== null && value !== undefined);
  if (expression.name === 'sum') {
    return values.reduce<number>((total, value) => total + numericValue(value), 0);
  }
  if (expression.name === 'avg') {
    return values.length
      ? values.reduce<number>((total, value) => total + numericValue(value), 0) / values.length
      : null;
  }
  if (expression.name === 'min') return minMax(values, 'min');
  if (expression.name === 'max') return minMax(values, 'max');
  return null;
}

function groupKeyPart(value: unknown): unknown {
  if (value === undefined) return { __fdqlMissing: true };
  return value;
}

function minMax(values: readonly unknown[], mode: 'max' | 'min'): unknown {
  let selected: unknown;
  for (const value of values) {
    const direction = mode === 'max' ? 1 : -1;
    if (selected === undefined || compareValues(value, selected) * direction > 0) {
      selected = value;
    }
  }
  return selected ?? null;
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
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

function unwindItems(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (isPlainRecord(value)) return Object.values(value);
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
  const documents: FdqlProviderRow[] = [];
  const events: FdqlExecutionEvent[] = [];
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
  return {
    events,
    row: {
      ...row,
      [stage.rowAlias]: stage.mode === 'one' ? documents[0] ?? null : documents,
    },
  };
}

function projectItems(
  items: readonly FdqlProjectionItem[],
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
): RowRecord {
  const projected: RowRecord = {};
  for (const item of items) {
    if (item.expression.kind === 'wildcard') {
      Object.assign(projected, expandWildcard(row));
      continue;
    }
    projected[item.alias ?? labelFor(item.expression, item.label)] = evaluateExpression(
      item.expression,
      contextFor(plan, row, runtime),
    );
  }
  return projected;
}

function expandWildcard(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, isDocument(value) ? value.data : value]),
  );
}

function labelFor(expression: FdqlExpression, fallback: string): string {
  if (expression.kind === 'field') return expression.path.at(-1) ?? fallback;
  if (expression.kind === 'call' && expression.name === 'fs.id') return 'id';
  return fallback;
}

function readDocuments(
  project: Readonly<Record<string, Readonly<Record<string, Record<string, unknown>>>>>,
  request: FdqlProviderReadRequest,
): readonly FdqlProviderRow[] {
  const collectionPathTarget = stringTarget(request, 'collectionPath');
  const collectionGroupTarget = stringTarget(request, 'collectionGroup');
  const projectId = stringTarget(request, 'projectId');
  const databaseId = stringTarget(request, 'databaseId');
  const entries = Object.entries(project).filter(([collectionPath]) =>
    collectionPathTarget
      ? collectionPath === collectionPathTarget
      : collectionPath.split('/').at(-1) === collectionGroupTarget
  );
  return entries.flatMap(([collectionPath, documents]) =>
    Object.entries(documents).map(([id, data]) => ({
      context: {
        ...(databaseId ? { databaseId } : {}),
        collectionPath,
        projectId,
      },
      data,
      id,
      path: `${collectionPath}/${id}`,
      provider: request.source.provider,
      source: request.source,
    }))
  );
}

function orderDocuments(
  documents: readonly FdqlProviderRow[],
  request: FdqlProviderReadRequest,
): readonly FdqlProviderRow[] {
  if (!request.orderBy) return documents;
  const direction = request.orderBy.direction === 'desc' ? -1 : 1;
  const sorted: FdqlProviderRow[] = [];
  for (const document of documents) {
    const index = sorted.findIndex((candidate) =>
      compareDocuments(document, candidate, request, direction) < 0
    );
    if (index < 0) sorted.push(document);
    else sorted.splice(index, 0, document);
  }
  return sorted;
}

function compareDocuments(
  left: FdqlProviderRow,
  right: FdqlProviderRow,
  request: FdqlProviderReadRequest,
  direction: number,
): number {
  if (!request.orderBy) return 0;
  const leftValue = evaluateExpression(request.orderBy.expression, {
    aliases: request.aliases,
    rows: { ...request.rows, [request.rowAlias]: left },
  });
  const rightValue = evaluateExpression(request.orderBy.expression, {
    aliases: request.aliases,
    rows: { ...request.rows, [request.rowAlias]: right },
  });
  if (leftValue === rightValue) return 0;
  return String(leftValue).localeCompare(String(rightValue)) * direction;
}

function applyFieldMask(
  document: FdqlProviderRow,
  request: FdqlProviderReadRequest,
): FdqlProviderRow {
  if (!request.fieldMask) return document;
  const data: Record<string, unknown> = {};
  for (const field of request.fieldMask) {
    const value = readPath(document.data, field.path);
    if (value !== undefined) writePath(data, field.path, value);
  }
  return {
    ...document,
    data,
  };
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
  return runtime.dialects ?? createProviderDialectRegistry([firestoreProviderDialect]);
}

function stringTarget(request: FdqlProviderReadRequest, key: string): string {
  const value = request.source.target[key];
  return typeof value === 'string' ? value : '';
}

function readPath(source: Readonly<Record<string, unknown>>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  const leaf = segments.at(-1);
  if (leaf) current[leaf] = value;
}

function freezeStats(stats: MutableStats): FdqlStats {
  return {
    aggregateSourceRows: stats.aggregateSourceRows,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
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

type RowRecord = Record<string, unknown>;

type MutableStats = {
  -readonly [Key in keyof FdqlStats]: Key extends 'providerReads' ? Record<string, number>
    : FdqlStats[Key];
};
