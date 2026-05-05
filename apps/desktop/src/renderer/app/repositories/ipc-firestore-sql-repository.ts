import type {
  FirestoreSqlCompileRequest,
  FirestoreSqlCompileResult,
  FirestoreSqlRepository,
  FirestoreSqlRunEventListener,
  FirestoreSqlRunRequest,
  FirestoreSqlRunResult,
} from '@firebase-desk/repo-contracts';

export class IpcFirestoreSqlRepository implements FirestoreSqlRepository {
  async compile(request: FirestoreSqlCompileRequest): Promise<FirestoreSqlCompileResult> {
    return await window.firebaseDesk.firestoreSql.compile(request);
  }

  async run(request: FirestoreSqlRunRequest): Promise<FirestoreSqlRunResult> {
    return await window.firebaseDesk.firestoreSql.run(request);
  }

  async cancel(runId: string): Promise<void> {
    await window.firebaseDesk.firestoreSql.cancel({ runId });
  }

  subscribe(listener: FirestoreSqlRunEventListener): () => void {
    return window.firebaseDesk.firestoreSql.subscribe(listener);
  }
}
