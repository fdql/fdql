import { type EvalContext, evaluateExpression, truthy } from './evaluator.ts';
import type {
  EvalRows,
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlFilterStage,
  FdqlLookupPlanStage,
  FdqlNativeReadPlan,
  FdqlProjectionItem,
  FdqlReadPlan,
  FdqlReadRequest,
  FdqlRuntime,
  FdqlRuntimeDocument,
  FdqlStats,
  FdqlTakeStage,
  FdqlUnwindStage,
  InMemoryFdqlRuntimeInput,
} from './types.ts';

export async function* executeFdql(
  plan: FdqlReadPlan,
  runtime: FdqlRuntime,
  options: FdqlExecutionOptions = {},
): AsyncIterable<FdqlExecutionEvent> {
  const startedAt = options.now?.() ?? Date.now();
  const stats = createStats(plan.settings.readBudget);
  const takeCounts = new Map<number, number>();
  yield { kind: 'started' };

  try {
    const request = createReadRequest(plan.native, plan, plan.rowAlias);
    for await (const document of runtime.read(request)) {
      yield recordRead(document, request, stats, false);

      const stopReason = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
      if (stopReason) {
        stats.stoppedReason = stopReason;
        for (const event of stopEvents(stats, stopReason)) yield event;
        return;
      }

      let rows: RowRecord[] = [{ [plan.rowAlias]: document }];
      // oxlint-disable no-await-in-loop -- Each local stage depends on the current row shape.
      for (const stage of plan.localStages) {
        if (stage.kind === 'filter') {
          rows = filterRows(stage, plan, rows);
        } else if (stage.kind === 'lookup') {
          const nextRows: RowRecord[] = [];
          for (const row of rows) {
            const lookup = await executeLookup(
              stage,
              plan,
              row,
              runtime,
              stats,
              startedAt,
              options,
            );
            for (const event of lookup.events) yield event;
            if (lookup.diagnostic) {
              yield { diagnostic: lookup.diagnostic, kind: 'failed' };
              return;
            }
            if (lookup.stopReason) {
              stats.stoppedReason = lookup.stopReason;
              for (const event of stopEvents(stats, lookup.stopReason)) yield event;
              return;
            }
            if (lookup.row) nextRows.push(lookup.row);
          }
          rows = nextRows;
        } else if (stage.kind === 'unwind') {
          rows = rows.flatMap((row) => unwindRow(stage, plan, row));
        } else if (stage.kind === 'with') {
          rows = rows.map((row) => projectItems(stage.items, plan, row));
        } else if (stage.kind === 'take') {
          rows = takeRows(stage, rows, takeCounts);
        }
        if (rows.length === 0) break;
      }
      // oxlint-enable no-await-in-loop
      if (rows.length === 0) {
        const filteredStopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
        if (filteredStopReason) {
          stats.stoppedReason = filteredStopReason;
          for (const event of stopEvents(stats, filteredStopReason)) yield event;
          return;
        }
        continue;
      }

      for (const row of rows) {
        const projected = projectItems(plan.returnStage.items, plan, row);
        stats.rowsOutput += 1;
        yield {
          kind: 'row',
          lineage: {
            documentPath: document.path,
            readContribution: 1,
            source: plan.native.source.sourceAlias,
          },
          row: projected,
        };
        yield { kind: 'stats', stats: freezeStats(stats) };
        const rowStopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
        if (rowStopReason) {
          stats.stoppedReason = rowStopReason;
          for (const event of stopEvents(stats, rowStopReason)) yield event;
          return;
        }
      }
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

export function createInMemoryFdqlRuntime(input: InMemoryFdqlRuntimeInput): FdqlRuntime {
  return {
    async *read(request) {
      const project = input.projects[request.projectId] ?? {};
      const documents = readDocuments(project, request);
      const filtered = documents.filter((document) =>
        !request.predicate
        || truthy(evaluateExpression(request.predicate, {
          aliases: request.aliases,
          rows: { ...request.rows, [request.rowAlias]: document },
        }))
      );
      const ordered = orderDocuments(filtered, request);
      const limited = ordered.slice(0, request.maxDocuments);
      for (const document of limited) {
        yield applyFieldMask(document, request);
      }
    },
  };
}

function createReadRequest(
  native: FdqlNativeReadPlan,
  plan: FdqlReadPlan,
  rowAlias: string,
  rows?: EvalRows,
  maxOverride?: number,
): FdqlReadRequest {
  const source = native.source;
  const remainingBudget = Math.max(0, plan.settings.readBudget);
  const maxDocuments = Math.min(
    native.limit ?? remainingBudget,
    remainingBudget,
    maxOverride ?? remainingBudget,
  );
  return {
    aliases: plan.aliases,
    ...(source.collectionGroup ? { collectionGroup: source.collectionGroup } : {}),
    ...(source.collectionPath ? { collectionPath: source.collectionPath } : {}),
    ...(source.databaseId ? { databaseId: source.databaseId } : {}),
    ...(native.fieldMask ? { fieldMask: native.fieldMask } : {}),
    ...(native.limit === undefined ? {} : { limit: native.limit }),
    maxDocuments,
    ...(native.orderBy ? { orderBy: native.orderBy } : {}),
    pageSize: Math.min(plan.settings.pageSize, maxDocuments),
    ...(native.predicate ? { predicate: native.predicate } : {}),
    projectId: source.projectId,
    rowAlias,
    ...(rows ? { rows } : {}),
  };
}

function recordRead(
  document: FdqlRuntimeDocument,
  request: FdqlReadRequest,
  stats: MutableStats,
  lookup: boolean,
): Extract<FdqlExecutionEvent, { readonly kind: 'read'; }> {
  stats.reads += 1;
  if (lookup) stats.lookupReads += 1;
  stats.rowsScanned += 1;
  stats.perProjectReads[document.projectId] = (stats.perProjectReads[document.projectId] ?? 0) + 1;
  return {
    collectionGroup: request.collectionGroup,
    collectionPath: request.collectionPath,
    count: 1,
    kind: 'read',
    projectId: document.projectId,
  };
}

function createStats(readBudget: number): MutableStats {
  return {
    aggregateSourceRows: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lookupReads: 0,
    perProjectReads: {},
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

function contextFor(plan: FdqlReadPlan, row: RowRecord): EvalContext {
  return {
    aliases: plan.aliases,
    rows: row as EvalRows,
  };
}

function filterRows(
  stage: FdqlFilterStage,
  plan: FdqlReadPlan,
  rows: readonly RowRecord[],
): RowRecord[] {
  return rows.filter((row) => truthy(evaluateExpression(stage.expression, contextFor(plan, row))));
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
  plan: FdqlReadPlan,
  row: RowRecord,
): RowRecord[] {
  const value = evaluateExpression(stage.expression, contextFor(plan, row));
  return unwindItems(value).map((item) => ({ ...row, [stage.rowAlias]: item }));
}

function unwindItems(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (isPlainRecord(value)) return Object.values(value);
  return [];
}

async function executeLookup(
  stage: FdqlLookupPlanStage,
  plan: FdqlReadPlan,
  row: RowRecord,
  runtime: FdqlRuntime,
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
  const lookupOneCap = stage.mode === 'one' && stage.native.limit === undefined ? 2 : undefined;
  const request = createReadRequest(
    stage.native,
    plan,
    stage.rowAlias,
    row as EvalRows,
    Math.min(remainingBudget, lookupOneCap ?? remainingBudget),
  );
  const documents: FdqlRuntimeDocument[] = [];
  const events: FdqlExecutionEvent[] = [];
  for await (const document of runtime.read(request)) {
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
  plan: FdqlReadPlan,
  row: RowRecord,
): RowRecord {
  const projected: RowRecord = {};
  for (const item of items) {
    if (item.expression.kind === 'wildcard') {
      Object.assign(projected, expandWildcard(row));
      continue;
    }
    projected[item.alias ?? labelFor(item.expression, item.label)] = evaluateExpression(
      item.expression,
      contextFor(plan, row),
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
  request: FdqlReadRequest,
): readonly FdqlRuntimeDocument[] {
  const entries = Object.entries(project).filter(([collectionPath]) =>
    request.collectionPath
      ? collectionPath === request.collectionPath
      : collectionPath.split('/').at(-1) === request.collectionGroup
  );
  return entries.flatMap(([collectionPath, documents]) =>
    Object.entries(documents).map(([id, data]) => ({
      collectionPath,
      data,
      ...(request.databaseId ? { databaseId: request.databaseId } : {}),
      id,
      path: `${collectionPath}/${id}`,
      projectId: request.projectId,
    }))
  );
}

function orderDocuments(
  documents: readonly FdqlRuntimeDocument[],
  request: FdqlReadRequest,
): readonly FdqlRuntimeDocument[] {
  if (!request.orderBy) return documents;
  const direction = request.orderBy.direction === 'desc' ? -1 : 1;
  const sorted: FdqlRuntimeDocument[] = [];
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
  left: FdqlRuntimeDocument,
  right: FdqlRuntimeDocument,
  request: FdqlReadRequest,
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
  document: FdqlRuntimeDocument,
  request: FdqlReadRequest,
): FdqlRuntimeDocument {
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
    perProjectReads: { ...stats.perProjectReads },
    readBudget: stats.readBudget,
    reads: stats.reads,
    rowsOutput: stats.rowsOutput,
    rowsScanned: stats.rowsScanned,
    ...(stats.stoppedReason ? { stoppedReason: stats.stoppedReason } : {}),
    unionBranches: stats.unionBranches,
  };
}

function isDocument(value: unknown): value is FdqlRuntimeDocument {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'collectionPath' in value
    && 'data' in value
    && 'id' in value
    && 'projectId' in value;
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
  -readonly [Key in keyof FdqlStats]: Key extends 'perProjectReads' ? Record<string, number>
    : FdqlStats[Key];
};
