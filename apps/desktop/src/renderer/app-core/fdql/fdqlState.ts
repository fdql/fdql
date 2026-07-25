import type { FdqlCompileResult, FdqlRunResult } from '@firebase-desk/repo-contracts';

export interface ActiveFdqlRun {
  readonly connectionId: string;
  readonly runId: string;
  readonly source: string;
  readonly startedAt: number;
}

export interface FdqlState {
  readonly activeRuns: Readonly<Record<string, ActiveFdqlRun>>;
  readonly compileResults: Readonly<Record<string, FdqlCompileResult>>;
  readonly results: Readonly<Record<string, FdqlRunResult>>;
  readonly runIds: Readonly<Record<string, string>>;
  readonly sources: Readonly<Record<string, string>>;
}

export interface CreateFdqlStateInput {
  readonly sources?: Readonly<Record<string, string>> | undefined;
}

export function createInitialFdqlState(input: CreateFdqlStateInput = {}): FdqlState {
  return {
    activeRuns: {},
    compileResults: {},
    results: {},
    runIds: {},
    sources: input.sources ?? {},
  };
}
