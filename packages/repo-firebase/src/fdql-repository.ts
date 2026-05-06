import {
  compileFdqlRead,
  executeFdql,
  type FdqlExecutionEvent,
  type FdqlExpression,
  type FdqlReadRequest,
  type FdqlRuntime,
  type FdqlRuntimeDocument,
  type FdqlValue,
} from '@firebase-desk/fdql';
import type {
  FdqlCompileRequest,
  FdqlCompileResult,
  FdqlDiagnostic,
  FdqlRepository,
  FdqlRunEvent,
  FdqlRunEventListener,
  FdqlRunResult,
  FdqlStats,
} from '@firebase-desk/repo-contracts';
import {
  FieldPath,
  Filter,
  type Query,
  type QueryDocumentSnapshot,
  Timestamp,
  type WhereFilterOp,
} from 'firebase-admin/firestore';
import type { AdminFirestoreProvider } from './admin-firestore-provider.ts';
import { encodeAdminData } from './value-codec.ts';

export function createFirebaseFdqlRepository(provider: AdminFirestoreProvider): FdqlRepository {
  const activeRuns = new Map<string, FdqlRunController>();
  const listeners = new Set<FdqlRunEventListener>();

  function emit(event: FdqlRunEvent): void {
    for (const listener of listeners) listener(event);
  }

  return {
    async compile(request): Promise<FdqlCompileResult> {
      const compiled = compileFdqlRead(request.source, compileOptions(request));
      return { diagnostics: compiled.diagnostics, ok: compiled.ok };
    },

    async run(request): Promise<FdqlRunResult> {
      const startedAt = Date.now();
      const controller = createFdqlRunController();
      activeRuns.set(request.runId, controller);
      emit({ runId: request.runId, type: 'started' });

      const compiled = compileFdqlRead(request.source, compileOptions(request));
      if (!compiled.ok || !compiled.plan) {
        const result = failedCompileResult(compiled.diagnostics, startedAt);
        for (const diagnostic of compiled.diagnostics) {
          emit({ diagnostic, runId: request.runId, type: 'diagnostic' });
        }
        emit({
          diagnostic: compiled.diagnostics[0] ?? fallbackDiagnostic(),
          result,
          runId: request.runId,
          type: 'failed',
        });
        activeRuns.delete(request.runId);
        return result;
      }

      const rows: Record<string, unknown>[] = [];
      const diagnostics: FdqlDiagnostic[] = [];
      let stats: FdqlStats | null = null;
      let cancelled = false;
      const runtime = createAdminFdqlRuntime(provider);

      for await (
        const event of executeFdql(
          compiled.plan,
          runtime,
          { signal: controller.signal },
        )
      ) {
        const mapped = eventToRunEvent(request.runId, event);
        if (mapped) emit(mapped);
        if (event.kind === 'row') rows.push(event.row);
        if (event.kind === 'diagnostic' || event.kind === 'failed') {
          diagnostics.push(event.diagnostic);
        }
        if (event.kind === 'stats' || event.kind === 'completed' || event.kind === 'cancelled') {
          stats = event.stats;
        }
        if (event.kind === 'cancelled') cancelled = true;
      }

      const result: FdqlRunResult = {
        ...(cancelled ? { cancelled: true } : {}),
        diagnostics,
        durationMs: Math.max(0, Date.now() - startedAt),
        rows,
        stats,
      };
      if (cancelled) emit({ result, runId: request.runId, type: 'cancelled' });
      else if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        emit({
          diagnostic: diagnostics[0] ?? fallbackDiagnostic(),
          result,
          runId: request.runId,
          type: 'failed',
        });
      } else {
        emit({ result, runId: request.runId, type: 'completed' });
      }
      activeRuns.delete(request.runId);
      return result;
    },

    async cancel(runId): Promise<void> {
      activeRuns.get(runId)?.abort();
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createAdminFdqlRuntime(provider: AdminFirestoreProvider): FdqlRuntime {
  return {
    async *read(request) {
      const { db } = await provider.getFirestoreConnection(request.projectId, request.databaseId);
      const base = request.collectionPath
        ? db.collection(request.collectionPath)
        : db.collectionGroup(request.collectionGroup ?? '');
      const snapshot = await applyNativeQuery(base, request).get();
      for (const doc of snapshot.docs) {
        yield documentFromSnapshot(request.projectId, request.databaseId, doc);
      }
    },
  };
}

function applyNativeQuery(
  query: Query,
  request: FdqlReadRequest,
): Query {
  let next = query;
  const filter = request.predicate ? filterFromExpression(request.predicate, request) : null;
  if (filter) next = next.where(filter);
  if (request.orderBy) {
    next = next.orderBy(
      fieldPathFromExpression(request.orderBy.expression, request.rowAlias),
      request.orderBy.direction,
    );
  }
  if (request.fieldMask) {
    next = next.select(...request.fieldMask.map((field) => toAdminFieldPath(field.path)));
  }
  if (request.limit !== undefined) next = next.limit(request.limit);
  return next;
}

function filterFromExpression(
  expression: FdqlExpression,
  request: FdqlReadRequest,
): Filter | null {
  if (expression.kind === 'binary' && expression.operator === 'and') {
    return Filter.and(
      ...[
        filterFromExpression(expression.left, request),
        filterFromExpression(expression.right, request),
      ]
        .filter((filter): filter is Filter => Boolean(filter)),
    );
  }
  if (expression.kind === 'binary' && expression.operator === 'or') {
    return Filter.or(
      ...[
        filterFromExpression(expression.left, request),
        filterFromExpression(expression.right, request),
      ]
        .filter((filter): filter is Filter => Boolean(filter)),
    );
  }
  if (expression.kind === 'binary') {
    return Filter.where(
      fieldPathFromExpression(expression.left, request.rowAlias),
      operatorFor(expression.operator),
      valueFor(expression.right, request.aliases ?? {}),
    );
  }
  if (expression.kind === 'call' && expression.name === 'fs.arrayContains') {
    return Filter.where(
      fieldPathFromExpression(expression.args[0]!, request.rowAlias),
      'array-contains',
      valueFor(expression.args[1]!, request.aliases ?? {}),
    );
  }
  return null;
}

function fieldPathFromExpression(expression: FdqlExpression, rowAlias: string): string | FieldPath {
  if (expression.kind === 'call' && expression.name === 'fs.id') return FieldPath.documentId();
  if (expression.kind === 'field') {
    return new FieldPath(...expression.path.slice(expression.path[0] === rowAlias ? 1 : 0));
  }
  return new FieldPath('__unsupported__');
}

function operatorFor(
  operator: Extract<FdqlExpression, { readonly kind: 'binary'; }>['operator'],
): WhereFilterOp {
  if (operator === '=') return '==';
  if (operator === '!=') return '!=';
  if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
    return operator;
  }
  if (operator === 'in') return 'in';
  return '==';
}

function valueFor(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, FdqlValue>>,
): unknown {
  if (expression.kind === 'literal') return expression.value;
  if (expression.kind === 'alias') return aliases[expression.name];
  if (expression.kind === 'array') return expression.items.map((item) => valueFor(item, aliases));
  if (expression.kind === 'map') {
    return Object.fromEntries(
      expression.entries.map((entry) => [entry.key, valueFor(entry.value, aliases)]),
    );
  }
  if (expression.kind === 'call' && expression.name === 'fs.timestamp') {
    const value = valueFor(expression.args[0]!, aliases);
    return typeof value === 'string' ? Timestamp.fromDate(new Date(value)) : value;
  }
  return undefined;
}

function compileOptions(request: FdqlCompileRequest) {
  return {
    defaultProjectId: request.defaultProjectId ?? request.connectionId,
    executionDefaults: {
      allowUnboundedReads: request.execution?.allowUnboundedReads ?? false,
      cache: request.execution?.cache ?? 'off',
      readBudget: request.execution?.readBudget ?? 5000,
      timeoutMs: request.execution?.timeoutMs ?? 60_000,
    },
  };
}

interface FdqlRunController {
  readonly signal: { readonly aborted: boolean; };
  abort(): void;
}

function createFdqlRunController(): FdqlRunController {
  let aborted = false;
  return {
    signal: {
      get aborted() {
        return aborted;
      },
    },
    abort() {
      aborted = true;
    },
  };
}

function documentFromSnapshot(
  projectId: string,
  databaseId: string | undefined,
  snapshot: QueryDocumentSnapshot,
): FdqlRuntimeDocument {
  return {
    collectionPath: snapshot.ref.parent.path,
    data: encodeAdminData(snapshot.data()),
    ...(databaseId ? { databaseId } : {}),
    id: snapshot.id,
    path: snapshot.ref.path,
    projectId,
  };
}

function toAdminFieldPath(path: string): FieldPath {
  return new FieldPath(...path.split('.'));
}

function eventToRunEvent(runId: string, event: FdqlExecutionEvent): FdqlRunEvent | null {
  switch (event.kind) {
    case 'started':
      return null;
    case 'diagnostic':
      return { diagnostic: event.diagnostic, runId, type: 'diagnostic' };
    case 'read':
      return {
        ...(event.collectionGroup === undefined ? {} : { collectionGroup: event.collectionGroup }),
        ...(event.collectionPath === undefined ? {} : { collectionPath: event.collectionPath }),
        count: event.count,
        projectId: event.projectId,
        runId,
        type: 'read',
      };
    case 'row':
      return { lineage: event.lineage, row: event.row, runId, type: 'row' };
    case 'stats':
      return { runId, stats: event.stats, type: 'stats' };
    case 'completed':
    case 'cancelled':
    case 'failed':
      return null;
  }
}

function failedCompileResult(
  diagnostics: readonly FdqlDiagnostic[],
  startedAt: number,
): FdqlRunResult {
  return {
    diagnostics,
    durationMs: Math.max(0, Date.now() - startedAt),
    rows: [],
    stats: null,
  };
}

function fallbackDiagnostic(): FdqlDiagnostic {
  return {
    code: 'FDQL_COMPILE_FAILED',
    message: 'FDQL compile failed.',
    severity: 'error',
  };
}
