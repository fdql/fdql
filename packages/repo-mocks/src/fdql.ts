import {
  FirestoreBytes,
  FirestoreGeoPoint,
  FirestoreReference,
  FirestoreTimestamp,
} from '@firebase-desk/data-format';
import {
  bytesValue,
  compareValues,
  compileFdql,
  createProviderDialectRegistry,
  evaluateExpression,
  executeFdql,
  type FdqlClearCacheCommandPlan,
  type FdqlExecutionEvent,
  type FdqlProviderReadRequest,
  type FdqlProviderRow,
  type FdqlProviderRuntimeRegistry,
  type FdqlValue,
  firestoreProviderDialect,
  geoPointValue,
  isMissingValue,
  mapValue,
  missingValue,
  providerValue,
  stringValue,
  timestampValue,
  toFdqlValue,
  truthy,
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
import { COLLECTIONS } from './fixtures/index.ts';

const firestoreDialects = createProviderDialectRegistry([firestoreProviderDialect]);

export function createMockFdqlRepository(): FdqlRepository {
  const activeRuns = new Map<string, FdqlRunController>();
  const listeners = new Set<FdqlRunEventListener>();

  function emit(event: FdqlRunEvent): void {
    for (const listener of listeners) listener(event);
  }

  return {
    async compile(request): Promise<FdqlCompileResult> {
      const compiled = compileFdql(request.source, compileOptions(request));
      return { diagnostics: compiled.diagnostics, ok: compiled.ok };
    },

    async run(request): Promise<FdqlRunResult> {
      const startedAt = Date.now();
      const controller = createFdqlRunController();
      activeRuns.set(request.runId, controller);
      emit({ runId: request.runId, type: 'started' });

      const compiled = compileFdql(request.source, compileOptions(request));
      if (!compiled.ok || !compiled.plan) {
        const result = resultFromCompileFailure(compiled.diagnostics, startedAt);
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

      if (compiled.plan.kind === 'clearCache') {
        const result = clearCacheResult(compiled.plan, startedAt);
        emit({ result, runId: request.runId, type: 'completed' });
        activeRuns.delete(request.runId);
        return result;
      }

      const rows: Record<string, unknown>[] = [];
      const diagnostics: FdqlDiagnostic[] = [];
      let stats: FdqlStats | null = null;
      let cancelled = false;

      for await (
        const event of executeFdql(
          compiled.plan,
          runtimeFor(request.connectionId),
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

function compileOptions(request: FdqlCompileRequest) {
  return {
    defaultProviderContext: {
      fs: { projectId: request.defaultProjectId ?? request.connectionId },
    },
    executionDefaults: {
      allowUnboundedReads: request.execution?.allowUnboundedReads ?? false,
      cache: request.execution?.cache ?? 'off',
      cacheTtlMs: request.execution?.cacheTtlMs ?? 86_400_000,
      pageSize: request.execution?.pageSize ?? 100,
      readBudget: request.execution?.readBudget ?? 5000,
      timeoutMs: request.execution?.timeoutMs ?? 60_000,
    },
    providers: [firestoreProviderDialect],
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

function runtimeFor(connectionId: string): FdqlProviderRuntimeRegistry {
  const project = fixtureProject();
  return {
    dialects: firestoreDialects,
    providers: {
      fs: {
        async *read(request) {
          const projectId = stringTarget(request, 'projectId');
          const selectedProject = {
            emu: project,
            prod: project,
            stage: project,
            [connectionId]: project,
          }[projectId] ?? {};
          const documents = readDocuments(selectedProject, request);
          const filtered = documents.filter((document) =>
            !request.predicate
            || truthy(evaluateExpression(request.predicate, {
              aliases: request.aliases,
              providers: firestoreDialects,
              rows: { ...request.rows, [request.rowAlias]: document },
            }))
          );
          for (const document of orderDocuments(filtered, request).slice(0, request.maxDocuments)) {
            yield applyFieldMask(document, request);
          }
        },
      },
    },
  };
}

type MockFirestoreProject = Readonly<
  Record<string, Readonly<Record<string, Record<string, FdqlValue>>>>
>;

function fixtureProject(): MockFirestoreProject {
  return Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection.path,
      Object.fromEntries(collection.docs.map((doc) => [doc.id, normalizeFixtureRecord(doc.data)])),
    ]),
  );
}

function readDocuments(
  project: MockFirestoreProject,
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
    providers: firestoreDialects,
    rows: { ...request.rows, [request.rowAlias]: left },
  });
  const rightValue = evaluateExpression(request.orderBy.expression, {
    aliases: request.aliases,
    providers: firestoreDialects,
    rows: { ...request.rows, [request.rowAlias]: right },
  });
  return compareValues(leftValue, rightValue) * direction;
}

function applyFieldMask(
  document: FdqlProviderRow,
  request: FdqlProviderReadRequest,
): FdqlProviderRow {
  if (!request.fieldMask) return document;
  const data: Record<string, FdqlValue> = {};
  for (const field of request.fieldMask) {
    const value = readPath(document.data, field.path);
    if (!isMissingValue(value)) writePath(data, field.path, value);
  }
  return { ...document, data };
}

function stringTarget(request: FdqlProviderReadRequest, key: string): string {
  const value = request.source.target[key];
  return typeof value === 'string' ? value : '';
}

function readPath(source: Readonly<Record<string, FdqlValue>>, path: string): FdqlValue {
  return path.split('.').reduce<FdqlValue>((value, segment) => {
    if (value.kind !== 'map') return missingValue;
    return value.value[segment] ?? missingValue;
  }, mapValue(source));
}

function writePath(target: Record<string, FdqlValue>, path: string, value: FdqlValue): void {
  const segments = path.split('.');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || existing.kind !== 'map') current[segment] = mapValue({});
    current = (current[segment] as Extract<FdqlValue, { readonly kind: 'map'; }>).value as Record<
      string,
      FdqlValue
    >;
  }
  const leaf = segments.at(-1);
  if (leaf) current[leaf] = value;
}

function normalizeFixtureRecord(
  data: Readonly<Record<string, unknown>>,
): Record<string, FdqlValue> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, normalizeFixtureValue(value)]),
  );
}

function normalizeFixtureValue(value: unknown): FdqlValue {
  if (value instanceof FirestoreTimestamp) return timestampValue(value.isoString);
  if (value instanceof FirestoreGeoPoint) return geoPointValue(value.latitude, value.longitude);
  if (value instanceof FirestoreBytes) return bytesValue(value.base64);
  if (value instanceof FirestoreReference) {
    return providerValue({
      display: value.path,
      equalityKey: `fs::(default):${value.path}`,
      provider: 'fs',
      value: {
        databaseId: stringValue('(default)'),
        path: stringValue(value.path),
        projectId: stringValue(''),
      },
      valueType: 'documentRef',
    });
  }
  if (Array.isArray(value)) return { kind: 'array', value: value.map(normalizeFixtureValue) };
  if (isPlainObject(value)) return { kind: 'map', value: normalizeFixtureRecord(value) };
  return toFdqlValue(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function eventToRunEvent(runId: string, event: FdqlExecutionEvent): FdqlRunEvent | null {
  switch (event.kind) {
    case 'started':
      return null;
    case 'diagnostic':
      return { diagnostic: event.diagnostic, runId, type: 'diagnostic' };
    case 'read':
      return {
        count: event.count,
        provider: event.provider,
        runId,
        source: event.source,
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

function resultFromCompileFailure(
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

function clearCacheResult(
  _plan: FdqlClearCacheCommandPlan,
  startedAt: number,
): FdqlRunResult {
  return {
    command: {
      clearedEntries: 0,
      kind: 'clearCache',
      message: 'Cleared 0 cache entries.',
    },
    diagnostics: [],
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
