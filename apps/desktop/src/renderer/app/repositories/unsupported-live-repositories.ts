import type {
  FirestoreSqlCompileRequest,
  FirestoreSqlCompileResult,
  FirestoreSqlRepository,
  FirestoreSqlRunEventListener,
  FirestoreSqlRunRequest,
  FirestoreSqlRunResult,
  ScriptRunEventListener,
  ScriptRunnerRepository,
  ScriptRunRequest,
  ScriptRunResult,
} from '@firebase-desk/repo-contracts';

const SCRIPT_RUNNER_UNAVAILABLE_MESSAGE = 'JavaScript Query live execution is not available yet.';
const FIRESTORE_SQL_UNAVAILABLE_MESSAGE = 'Firestore SQL live execution is not available yet.';

export class UnsupportedLiveScriptRunnerRepository implements ScriptRunnerRepository {
  async run(_request: ScriptRunRequest): Promise<ScriptRunResult> {
    throw new Error(SCRIPT_RUNNER_UNAVAILABLE_MESSAGE);
  }

  async cancel(_runId: string): Promise<void> {
    throw new Error(SCRIPT_RUNNER_UNAVAILABLE_MESSAGE);
  }

  subscribe(_listener: ScriptRunEventListener): () => void {
    return () => {};
  }
}

export class UnsupportedLiveFirestoreSqlRepository implements FirestoreSqlRepository {
  async compile(_request: FirestoreSqlCompileRequest): Promise<FirestoreSqlCompileResult> {
    throw new Error(FIRESTORE_SQL_UNAVAILABLE_MESSAGE);
  }

  async run(_request: FirestoreSqlRunRequest): Promise<FirestoreSqlRunResult> {
    throw new Error(FIRESTORE_SQL_UNAVAILABLE_MESSAGE);
  }

  async cancel(_runId: string): Promise<void> {
    throw new Error(FIRESTORE_SQL_UNAVAILABLE_MESSAGE);
  }

  subscribe(_listener: FirestoreSqlRunEventListener): () => void {
    return () => {};
  }
}
