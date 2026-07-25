import type {
  FirestoreSqlCompileResult,
  FirestoreSqlContext,
  FirestoreSqlRunResult,
} from '@firebase-desk/repo-contracts';

export interface ActiveFirestoreSqlRun {
  readonly connectionId: string;
  readonly runId: string;
  readonly source: string;
  readonly startedAt: number;
}

export interface FirestoreSqlState {
  readonly activeRuns: Readonly<Record<string, ActiveFirestoreSqlRun>>;
  readonly compileResults: Readonly<Record<string, FirestoreSqlCompileResult>>;
  readonly contexts: Readonly<Record<string, FirestoreSqlContext>>;
  readonly results: Readonly<Record<string, FirestoreSqlRunResult>>;
  readonly runIds: Readonly<Record<string, string>>;
  readonly sources: Readonly<Record<string, string>>;
}

export interface CreateFirestoreSqlStateInput {
  readonly contexts?: Readonly<Record<string, FirestoreSqlContext>> | undefined;
  readonly sources?: Readonly<Record<string, string>> | undefined;
}

export function createInitialFirestoreSqlState(
  input: CreateFirestoreSqlStateInput = {},
): FirestoreSqlState {
  return {
    activeRuns: {},
    compileResults: {},
    contexts: input.contexts ?? {},
    results: {},
    runIds: {},
    sources: input.sources ?? {},
  };
}
