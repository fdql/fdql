import type { BackgroundJob, BackgroundJobEvent } from '@firebase-desk/repo-contracts/jobs';
import type { JobsState } from './jobsState.ts';

export function jobsLoadStarted(state: JobsState): JobsState {
  return { ...state, errorMessage: null, eventsDuringLoad: {}, isLoading: true };
}

export function jobsLoadSucceeded(
  state: JobsState,
  jobs: ReadonlyArray<BackgroundJob>,
): JobsState {
  const mergedJobs = Object.entries(state.eventsDuringLoad).reduce(
    (current, [id, eventJob]) =>
      eventJob ? upsertNewerJob(current, eventJob) : current.filter((job) => job.id !== id),
    jobs,
  );
  const acknowledgedIssueJobIds = state.open
    ? issueJobIds(mergedJobs)
    : pruneAcknowledgedIssueJobIds(state.acknowledgedIssueJobIds, mergedJobs);
  return {
    ...state,
    acknowledgedIssueJobIds,
    errorMessage: null,
    eventsDuringLoad: {},
    isLoading: false,
    jobs: mergedJobs,
  };
}

export function jobsLoadFailed(state: JobsState, message: string): JobsState {
  return { ...state, errorMessage: message, isLoading: false };
}

export function jobsDrawerOpened(state: JobsState): JobsState {
  return { ...state, acknowledgedIssueJobIds: issueJobIds(state.jobs), open: true };
}

export function jobsDrawerClosed(state: JobsState): JobsState {
  return { ...state, open: false };
}

export function jobsDrawerToggled(state: JobsState): JobsState {
  return state.open ? jobsDrawerClosed(state) : jobsDrawerOpened(state);
}

export function jobsExpandedChanged(state: JobsState, expanded: boolean): JobsState {
  return { ...state, expanded };
}

export function jobsEventReceived(state: JobsState, event: BackgroundJobEvent): JobsState {
  if (event.type === 'job-removed') {
    const jobs = state.jobs.filter((job) => job.id !== event.id);
    return {
      ...state,
      acknowledgedIssueJobIds: state.acknowledgedIssueJobIds.filter((id) => id !== event.id),
      eventsDuringLoad: state.isLoading
        ? { ...state.eventsDuringLoad, [event.id]: null }
        : state.eventsDuringLoad,
      jobs,
    };
  }
  const jobs = upsertNewerJob(state.jobs, event.job);
  const pendingJob = state.eventsDuringLoad[event.job.id];
  const eventsDuringLoad = state.isLoading
    ? {
      ...state.eventsDuringLoad,
      [event.job.id]: pendingJob && pendingJob.updatedAt > event.job.updatedAt
        ? pendingJob
        : event.job,
    }
    : state.eventsDuringLoad;
  const acknowledgedIssueJobIds = state.open && isIssueJob(event.job)
    ? unique([...state.acknowledgedIssueJobIds, event.job.id])
    : pruneAcknowledgedIssueJobIds(state.acknowledgedIssueJobIds, jobs);
  return {
    ...state,
    acknowledgedIssueJobIds,
    eventsDuringLoad,
    jobs,
  };
}

function upsertNewerJob(
  jobs: ReadonlyArray<BackgroundJob>,
  candidate: BackgroundJob,
): ReadonlyArray<BackgroundJob> {
  const existing = jobs.find((job) => job.id === candidate.id);
  if (!existing) return [candidate, ...jobs];
  if (existing.updatedAt > candidate.updatedAt) return jobs;
  return jobs.map((job) => job.id === candidate.id ? candidate : job);
}

function issueJobIds(jobs: ReadonlyArray<BackgroundJob>): string[] {
  return jobs.filter(isIssueJob).map((job) => job.id);
}

function isIssueJob(job: BackgroundJob): boolean {
  return job.status === 'failed' || job.status === 'interrupted';
}

function pruneAcknowledgedIssueJobIds(
  ids: ReadonlyArray<string>,
  jobs: ReadonlyArray<BackgroundJob>,
): string[] {
  const issueIds = new Set(issueJobIds(jobs));
  return ids.filter((id) => issueIds.has(id));
}

function unique(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values));
}
