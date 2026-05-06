import {
  compileFdqlRead,
  createInMemoryFdqlRuntime,
  executeFdql,
  type FdqlExecutionEvent,
  type InMemoryFdqlRuntimeInput,
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

export function createMockFdqlRepository(): FdqlRepository {
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

      const rows: Record<string, unknown>[] = [];
      const diagnostics: FdqlDiagnostic[] = [];
      let stats: FdqlStats | null = null;
      let cancelled = false;

      for await (
        const event of executeFdql(
          compiled.plan,
          createInMemoryFdqlRuntime(runtimeFor(request.connectionId)),
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

function runtimeFor(connectionId: string): InMemoryFdqlRuntimeInput {
  const project = fixtureProject();
  return {
    projects: {
      emu: project,
      prod: project,
      stage: project,
      [connectionId]: project,
    },
  };
}

function fixtureProject(): InMemoryFdqlRuntimeInput['projects'][string] {
  return Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection.path,
      Object.fromEntries(collection.docs.map((doc) => [doc.id, doc.data])),
    ]),
  );
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

function fallbackDiagnostic(): FdqlDiagnostic {
  return {
    code: 'FDQL_COMPILE_FAILED',
    message: 'FDQL compile failed.',
    severity: 'error',
  };
}
