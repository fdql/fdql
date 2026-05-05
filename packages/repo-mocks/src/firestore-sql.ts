import {
  compileFirestoreSqlRead,
  executeFirestoreSql,
  type ExecutionEvent,
  generateFirestoreDeskJsQuerySnippet,
  type InMemoryFirestoreSqlRuntime,
} from '@firebase-desk/firestore-sql';
import type {
  FirestoreSqlCompileRequest,
  FirestoreSqlCompileResult,
  FirestoreSqlDiagnostic,
  FirestoreSqlRepository,
  FirestoreSqlRunEvent,
  FirestoreSqlRunEventListener,
  FirestoreSqlRunRequest,
  FirestoreSqlRunResult,
  FirestoreSqlStats,
} from '@firebase-desk/repo-contracts';
import { COLLECTIONS } from './fixtures/index.ts';

export class MockFirestoreSqlRepository implements FirestoreSqlRepository {
  private readonly activeRuns = new Map<string, SqlRunController>();
  private readonly listeners = new Set<FirestoreSqlRunEventListener>();

  async compile(request: FirestoreSqlCompileRequest): Promise<FirestoreSqlCompileResult> {
    const compiled = compileFirestoreSqlRead(request.source, compileOptions(request));
    const snippet = compiled.plan
      ? generateFirestoreDeskJsQuerySnippet(compiled.plan).source
      : undefined;
    return {
      diagnostics: compiled.diagnostics,
      ok: compiled.ok,
      ...(compiled.plan ? { plan: compiled.plan } : {}),
      ...(snippet ? { snippet } : {}),
    };
  }

  async run(request: FirestoreSqlRunRequest): Promise<FirestoreSqlRunResult> {
    const startedAt = Date.now();
    const controller = createSqlRunController();
    this.activeRuns.set(request.runId, controller);
    this.emit({ runId: request.runId, type: 'started' });

    const compiled = compileFirestoreSqlRead(request.source, compileOptions(request));
    if (!compiled.ok || !compiled.plan) {
      const result = resultFromCompileFailure(compiled.diagnostics, startedAt);
      for (const diagnostic of compiled.diagnostics) {
        this.emit({ diagnostic, runId: request.runId, type: 'diagnostic' });
      }
      this.emit({
        diagnostic: compiled.diagnostics[0] ?? fallbackDiagnostic(),
        result,
        runId: request.runId,
        type: 'failed',
      });
      this.activeRuns.delete(request.runId);
      return result;
    }

    this.emit({ plan: compiled.plan, runId: request.runId, type: 'plan' });

    const rows: Record<string, unknown>[] = [];
    const diagnostics: FirestoreSqlDiagnostic[] = [];
    let stats: FirestoreSqlStats | null = null;
    let cancelled = false;

    for await (
      const event of executeFirestoreSql(
        compiled.plan,
        runtimeFor(request.connectionId),
        executionOptions(request, controller),
      )
    ) {
      const mapped = eventToRunEvent(request.runId, event);
      if (mapped) this.emit(mapped);
      if (event.kind === 'row') rows.push(event.row);
      if (event.kind === 'diagnostic' || event.kind === 'failed') {
        diagnostics.push(event.diagnostic);
      }
      if (event.kind === 'stats' || event.kind === 'completed' || event.kind === 'cancelled') {
        stats = event.stats;
      }
      if (event.kind === 'cancelled') cancelled = true;
    }

    const result: FirestoreSqlRunResult = {
      ...(cancelled ? { cancelled: true } : {}),
      diagnostics,
      durationMs: Math.max(0, Date.now() - startedAt),
      rows,
      stats,
    };
    if (cancelled) this.emit({ result, runId: request.runId, type: 'cancelled' });
    else if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      this.emit({
        diagnostic: diagnostics[0] ?? fallbackDiagnostic(),
        result,
        runId: request.runId,
        type: 'failed',
      });
    } else {
      this.emit({ result, runId: request.runId, type: 'completed' });
    }
    this.activeRuns.delete(request.runId);
    return result;
  }

  async cancel(runId: string): Promise<void> {
    this.activeRuns.get(runId)?.abort();
  }

  subscribe(listener: FirestoreSqlRunEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: FirestoreSqlRunEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function compileOptions(request: FirestoreSqlCompileRequest) {
  return {
    defaultProjectId: request.context?.defaultProjectId ?? request.connectionId,
    executionDefaults: {
      pageSize: request.execution?.pageSize ?? 100,
      readBudget: request.execution?.readBudget ?? 5000,
      timeoutMs: request.execution?.timeoutMs ?? 60_000,
    },
    projectAliases: {
      emu: 'emu',
      prod: 'prod',
      stage: 'stage',
      staging: 'stage',
      ...request.context?.projectAliases,
    },
    ...(request.execution?.readBudget === undefined
      ? {}
      : { readBudget: request.execution.readBudget }),
    ...(request.execution?.timeoutMs === undefined
      ? {}
      : { timeoutMs: request.execution.timeoutMs }),
  };
}

interface SqlRunController {
  readonly signal: { readonly aborted: boolean; };
  abort(): void;
}

function createSqlRunController(): SqlRunController {
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

function executionOptions(
  request: FirestoreSqlRunRequest,
  controller: SqlRunController,
) {
  return {
    signal: controller.signal,
    ...(request.execution?.readBudget === undefined
      ? {}
      : { readBudget: request.execution.readBudget }),
    ...(request.execution?.timeoutMs === undefined
      ? {}
      : { timeoutMs: request.execution.timeoutMs }),
  };
}

function runtimeFor(connectionId: string): InMemoryFirestoreSqlRuntime {
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

function fixtureProject(): InMemoryFirestoreSqlRuntime['projects'][string] {
  return Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection.path,
      Object.fromEntries(collection.docs.map((doc) => [doc.id, doc.data])),
    ]),
  );
}

function eventToRunEvent(runId: string, event: ExecutionEvent): FirestoreSqlRunEvent | null {
  switch (event.kind) {
    case 'started':
      return null;
    case 'plan':
      return { plan: event.plan, runId, type: 'plan' };
    case 'diagnostic':
      return { diagnostic: event.diagnostic, runId, type: 'diagnostic' };
    case 'read':
      return { ...event, runId, type: 'read' };
    case 'row':
      return { lineage: event.lineage, row: event.row, runId, type: 'row' };
    case 'stats':
      return { runId, stats: event.stats, type: 'stats' };
    case 'completed':
    case 'cancelled':
    case 'failed':
      return null;
  }
  return null;
}

function resultFromCompileFailure(
  diagnostics: readonly FirestoreSqlDiagnostic[],
  startedAt: number,
): FirestoreSqlRunResult {
  return {
    diagnostics,
    durationMs: Math.max(0, Date.now() - startedAt),
    rows: [],
    stats: null,
  };
}

function fallbackDiagnostic(): FirestoreSqlDiagnostic {
  return {
    code: 'SQL_COMPILE_FAILED',
    message: 'SQL compile failed.',
    severity: 'error',
  };
}
