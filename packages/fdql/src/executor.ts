import { type EvalContext, evaluateExpression, truthy } from './evaluator.ts';
import type {
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlProjectionItem,
  FdqlReadPlan,
  FdqlReadRequest,
  FdqlRuntime,
  FdqlRuntimeDocument,
  FdqlStats,
  InMemoryFdqlRuntimeInput,
} from './types.ts';

export async function* executeFdql(
  plan: FdqlReadPlan,
  runtime: FdqlRuntime,
  options: FdqlExecutionOptions = {},
): AsyncIterable<FdqlExecutionEvent> {
  const startedAt = options.now?.() ?? Date.now();
  const stats = createStats(plan.settings.readBudget);
  let outputCount = 0;
  yield { kind: 'started' };

  try {
    const request = createReadRequest(plan);
    for await (const document of runtime.read(request)) {
      stats.reads += 1;
      stats.rowsScanned += 1;
      stats.perProjectReads[document.projectId] = (stats.perProjectReads[document.projectId] ?? 0)
        + 1;
      yield {
        collectionGroup: request.collectionGroup,
        collectionPath: request.collectionPath,
        count: 1,
        kind: 'read',
        projectId: document.projectId,
      };

      const stopReason = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
      if (stopReason) {
        stats.stoppedReason = stopReason;
        for (const event of stopEvents(stats, stopReason)) yield event;
        return;
      }

      let row: Record<string, unknown> | null = { [plan.rowAlias]: document };
      for (const stage of plan.localStages) {
        if (stage.kind === 'filter') {
          row = truthy(evaluateExpression(stage.expression, contextFor(plan, row))) ? row : null;
        } else if (stage.kind === 'with') {
          row = projectItems(stage.items, plan, row);
        } else if (stage.kind === 'take' && outputCount >= stage.value) {
          row = null;
        }
        if (!row) break;
      }
      if (!row) {
        const filteredStopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
        if (filteredStopReason) {
          stats.stoppedReason = filteredStopReason;
          for (const event of stopEvents(stats, filteredStopReason)) yield event;
          return;
        }
        continue;
      }

      const projected = projectItems(plan.returnStage.items, plan, row);
      outputCount += 1;
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
          rows: { [request.rowAlias]: document },
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

function createReadRequest(plan: FdqlReadPlan): FdqlReadRequest {
  const source = plan.native.source;
  const maxDocuments = Math.min(
    plan.native.limit ?? plan.settings.readBudget,
    plan.settings.readBudget,
  );
  return {
    aliases: plan.aliases,
    ...(source.collectionGroup ? { collectionGroup: source.collectionGroup } : {}),
    ...(source.collectionPath ? { collectionPath: source.collectionPath } : {}),
    ...(source.databaseId ? { databaseId: source.databaseId } : {}),
    ...(plan.native.fieldMask ? { fieldMask: plan.native.fieldMask } : {}),
    ...(plan.native.limit === undefined ? {} : { limit: plan.native.limit }),
    maxDocuments,
    ...(plan.native.orderBy ? { orderBy: plan.native.orderBy } : {}),
    pageSize: Math.min(plan.settings.pageSize, maxDocuments),
    ...(plan.native.predicate ? { predicate: plan.native.predicate } : {}),
    projectId: source.projectId,
    rowAlias: plan.rowAlias,
  };
}

function createStats(readBudget: number): MutableStats {
  return {
    perProjectReads: {},
    readBudget,
    reads: 0,
    rowsOutput: 0,
    rowsScanned: 0,
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

function contextFor(plan: FdqlReadPlan, row: Record<string, unknown>): EvalContext {
  return {
    aliases: plan.aliases,
    rows: row as EvalContext['rows'],
  };
}

function projectItems(
  items: readonly FdqlProjectionItem[],
  plan: FdqlReadPlan,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
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
    rows: { [request.rowAlias]: left },
  });
  const rightValue = evaluateExpression(request.orderBy.expression, {
    aliases: request.aliases,
    rows: { [request.rowAlias]: right },
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
    perProjectReads: { ...stats.perProjectReads },
    readBudget: stats.readBudget,
    reads: stats.reads,
    rowsOutput: stats.rowsOutput,
    rowsScanned: stats.rowsScanned,
    ...(stats.stoppedReason ? { stoppedReason: stats.stoppedReason } : {}),
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

type MutableStats = {
  -readonly [Key in keyof FdqlStats]: Key extends 'perProjectReads' ? Record<string, number>
    : FdqlStats[Key];
};
