import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';

export interface JobsState {
  readonly acknowledgedIssueJobIds: ReadonlyArray<string>;
  readonly errorMessage: string | null;
  readonly eventsDuringLoad: Readonly<Record<string, BackgroundJob | null>>;
  readonly expanded: boolean;
  readonly isLoading: boolean;
  readonly jobs: ReadonlyArray<BackgroundJob>;
  readonly open: boolean;
}

export function createInitialJobsState(input: Partial<JobsState> = {}): JobsState {
  return {
    acknowledgedIssueJobIds: [],
    errorMessage: null,
    eventsDuringLoad: {},
    expanded: false,
    isLoading: false,
    jobs: [],
    open: false,
    ...input,
  };
}
