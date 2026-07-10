import type {
  BackgroundJob,
  BackgroundJobRepository,
  FirestoreCollectionJobRequest,
} from '@firebase-desk/repo-contracts/jobs';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { messageFromError } from '../shared/errors.ts';
import { useAppCoreStore } from '../shared/reactStore.ts';
import { selectJobsButtonModel } from './jobsSelectors.ts';
import { createJobsStore, type JobsStore } from './jobsStore.ts';
import {
  jobsDrawerClosed,
  jobsDrawerOpened,
  jobsEventReceived,
  jobsExpandedChanged,
  jobsLoadFailed,
  jobsLoadStarted,
  jobsLoadSucceeded,
} from './jobsTransitions.ts';

export interface UseJobsControllerInput {
  readonly onJobSucceeded?: ((job: BackgroundJob) => void) | undefined;
  readonly onStatus?: ((message: string) => void) | undefined;
  readonly repository: BackgroundJobRepository;
  readonly store?: JobsStore | undefined;
}

export function useJobsController(
  { onJobSucceeded, onStatus, repository, store: inputStore }: UseJobsControllerInput,
) {
  const [ownedStore] = useState(createJobsStore);
  const store = inputStore ?? ownedStore;
  const state = useAppCoreStore(store);
  const notifyJobSucceeded = useEffectEvent((job: BackgroundJob) => onJobSucceeded?.(job));

  const acknowledgeIssueJobs = useCallback((jobs: ReadonlyArray<BackgroundJob>) => {
    const ids = jobs.filter(isUnacknowledgedIssueJob).map((job) => job.id);
    if (ids.length === 0) return;
    void repository.acknowledgeIssues(ids).catch((error: unknown) => {
      onStatus?.(messageFromError(error, 'Could not acknowledge jobs.'));
    });
  }, [onStatus, repository]);

  const load = useCallback(() => {
    store.update(jobsLoadStarted);
    repository.list({ limit: 200 })
      .then((jobs) => {
        store.update((current) => jobsLoadSucceeded(current, jobs));
        if (store.get().open) acknowledgeIssueJobs(jobs);
      })
      .catch((error: unknown) => {
        const message = messageFromError(error, 'Could not load jobs.');
        store.update((current) => jobsLoadFailed(current, message));
        onStatus?.(message);
      });
  }, [acknowledgeIssueJobs, onStatus, repository, store]);

  useEffect(() => {
    load();
    return repository.subscribe((event) => {
      store.update((current) => jobsEventReceived(current, event));
      if (store.get().open && event.type !== 'job-removed') acknowledgeIssueJobs([event.job]);
      if (
        event.type === 'job-updated' && isFinalStatus(event.job.status) && !event.job.acknowledgedAt
      ) {
        onStatus?.(event.job.summary ?? event.job.status);
      }
      if (event.type !== 'job-removed' && event.job.status === 'succeeded') {
        notifyJobSucceeded(event.job);
      }
    });
  }, [acknowledgeIssueJobs, load, onStatus, repository, store]);

  const button = useMemo(() => selectJobsButtonModel(state), [state]);

  const start = useCallback(async (request: FirestoreCollectionJobRequest) => {
    const job = await repository.start(request);
    onStatus?.(`Queued ${job.title.toLowerCase()}`);
    return job;
  }, [onStatus, repository]);

  const cancel = useCallback((id: string) => {
    void repository.cancel(id).catch((error: unknown) => {
      onStatus?.(messageFromError(error, 'Could not cancel job.'));
    });
  }, [onStatus, repository]);

  const clearCompleted = useCallback(() => {
    void repository.clearCompleted().catch((error: unknown) => {
      onStatus?.(messageFromError(error, 'Could not clear completed jobs.'));
    });
  }, [onStatus, repository]);

  const openDrawer = useCallback(() => {
    const jobs = store.get().jobs;
    store.update(jobsDrawerOpened);
    acknowledgeIssueJobs(jobs);
  }, [acknowledgeIssueJobs, store]);

  const toggleDrawer = useCallback(() => {
    if (store.get().open) store.update(jobsDrawerClosed);
    else openDrawer();
  }, [openDrawer, store]);

  return {
    button,
    cancel,
    clearCompleted,
    close: () => store.update(jobsDrawerClosed),
    expanded: state.expanded,
    isLoading: state.isLoading,
    jobs: state.jobs,
    load,
    open: openDrawer,
    opened: state.open,
    setExpanded: (expanded: boolean) =>
      store.update((current) => jobsExpandedChanged(current, expanded)),
    start,
    state,
    toggle: toggleDrawer,
  };
}

function isUnacknowledgedIssueJob(job: BackgroundJob): boolean {
  return !job.acknowledgedAt && (job.status === 'failed' || job.status === 'interrupted');
}

function isFinalStatus(status: string): boolean {
  return status === 'cancelled'
    || status === 'failed'
    || status === 'interrupted'
    || status === 'succeeded';
}
