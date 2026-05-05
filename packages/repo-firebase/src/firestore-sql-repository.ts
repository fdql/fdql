import {
  compileFirestoreSqlRead,
  executeFirestoreSql,
  type ExecutionEvent,
  type FirestoreSqlReadRequest,
  type FirestoreSqlRuntime,
  type FirestoreSqlRuntimeCollection,
  type FirestoreSqlRuntimeDocument,
  type FirestoreSqlSubcollectionRequest,
  generateFirestoreDeskJsQuerySnippet,
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
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { AdminFirestoreProvider } from './admin-firestore-provider.ts';
import { encodeAdminData } from './value-codec.ts';

export class FirebaseFirestoreSqlRepository implements FirestoreSqlRepository {
  private readonly activeRuns = new Map<string, SqlRunController>();
  private readonly listeners = new Set<FirestoreSqlRunEventListener>();

  constructor(private readonly provider: AdminFirestoreProvider) {}

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
      const result = failedCompileResult(compiled.diagnostics, startedAt);
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
    const runtime = new AdminFirestoreSqlRuntime(this.provider);

    for await (
      const event of executeFirestoreSql(
        compiled.plan,
        runtime,
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

class AdminFirestoreSqlRuntime implements FirestoreSqlRuntime {
  constructor(private readonly provider: AdminFirestoreProvider) {}

  async *readCollection(
    request: FirestoreSqlReadRequest & {
      readonly collectionPath: string;
    },
  ): AsyncIterable<FirestoreSqlRuntimeDocument> {
    const { db } = await this.provider.getFirestoreConnection(request.projectId);
    const query = db.collection(request.collectionPath);
    const snapshot = await (request.limit === undefined ? query : query.limit(request.limit)).get();
    for (const doc of snapshot.docs) yield documentFromSnapshot(request.projectId, doc);
  }

  async *readCollectionGroup(
    request: FirestoreSqlReadRequest & {
      readonly collectionGroup: string;
    },
  ): AsyncIterable<FirestoreSqlRuntimeDocument> {
    const { db } = await this.provider.getFirestoreConnection(request.projectId);
    const query = db.collectionGroup(request.collectionGroup);
    const snapshot = await (request.limit === undefined ? query : query.limit(request.limit)).get();
    for (const doc of snapshot.docs) yield documentFromSnapshot(request.projectId, doc);
  }

  async *readSubcollection(request: FirestoreSqlSubcollectionRequest): AsyncIterable<
    FirestoreSqlRuntimeDocument
  > {
    const { db } = await this.provider.getFirestoreConnection(request.parent.projectId);
    const query = db.doc(documentPath(request.parent)).collection(request.name);
    const snapshot = await (request.limit === undefined ? query : query.limit(request.limit)).get();
    for (const doc of snapshot.docs) yield documentFromSnapshot(request.parent.projectId, doc);
  }

  async listSubcollections(
    parent: FirestoreSqlRuntimeDocument,
  ): Promise<ReadonlyArray<FirestoreSqlRuntimeCollection>> {
    const { db } = await this.provider.getFirestoreConnection(parent.projectId);
    const collections = await db.doc(documentPath(parent)).listCollections();
    return collections.map((collection) => ({
      id: collection.id,
      parentPath: documentPath(parent),
      path: collection.path,
      projectId: parent.projectId,
    }));
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

function documentFromSnapshot(
  projectId: string,
  snapshot: QueryDocumentSnapshot,
): FirestoreSqlRuntimeDocument {
  return {
    collectionPath: snapshot.ref.parent.path,
    data: encodeAdminData(snapshot.data()),
    id: snapshot.id,
    path: snapshot.ref.path,
    projectId,
  };
}

function documentPath(document: FirestoreSqlRuntimeDocument): string {
  return document.path ?? `${document.collectionPath}/${document.id}`;
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

function failedCompileResult(
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
