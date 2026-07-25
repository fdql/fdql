import type {
  BackgroundJob,
  FirestoreCollectionJobRequest,
} from '@firebase-desk/repo-contracts/jobs';
import { describe, expect, it } from 'vitest';
import { selectJobsButtonModel } from './jobsSelectors.ts';
import { createInitialJobsState } from './jobsState.ts';
import {
  jobsDrawerOpened,
  jobsEventReceived,
  jobsLoadStarted,
  jobsLoadSucceeded,
} from './jobsTransitions.ts';

describe('jobsTransitions', () => {
  it('clears failed job badge when the drawer opens', () => {
    const state = jobsLoadSucceeded(createInitialJobsState(), [job('job-1', 'failed')]);

    expect(selectJobsButtonModel(state)).toMatchObject({
      badge: { label: '1', variant: 'danger' },
      variant: 'warning',
    });

    const opened = jobsDrawerOpened(state);

    expect(opened.acknowledgedIssueJobIds).toEqual(['job-1']);
    expect(selectJobsButtonModel(opened)).toEqual({ badge: null, variant: 'secondary' });
  });

  it('shows a new failed job badge after earlier failures were acknowledged', () => {
    const opened = jobsDrawerOpened(
      jobsLoadSucceeded(createInitialJobsState(), [job('job-1', 'failed')]),
    );

    const updated = jobsEventReceived(
      { ...opened, open: false },
      { job: job('job-2', 'failed'), type: 'job-added' },
    );

    expect(updated.acknowledgedIssueJobIds).toEqual(['job-1']);
    expect(selectJobsButtonModel(updated)).toMatchObject({
      badge: { label: '1', variant: 'danger' },
      variant: 'warning',
    });
  });

  it('does not create a failed job badge for events received while the drawer is open', () => {
    const updated = jobsEventReceived(
      createInitialJobsState({ open: true }),
      { job: job('job-1', 'interrupted'), type: 'job-added' },
    );

    expect(updated.acknowledgedIssueJobIds).toEqual(['job-1']);
    expect(selectJobsButtonModel(updated)).toEqual({ badge: null, variant: 'secondary' });
  });

  it('does not badge failed jobs that were acknowledged before reload', () => {
    const state = jobsLoadSucceeded(createInitialJobsState(), [
      { ...job('job-1', 'failed'), acknowledgedAt: '2026-04-29T00:01:00.000Z' },
    ]);

    expect(selectJobsButtonModel(state)).toEqual({ badge: null, variant: 'ghost' });
  });

  it('preserves subscription events received during an older list request', () => {
    const loading = jobsLoadStarted(createInitialJobsState());
    const eventJob = {
      ...job('job-1', 'running'),
      updatedAt: '2026-04-29T00:02:00.000Z',
    };
    const withEvent = jobsEventReceived(loading, { job: eventJob, type: 'job-updated' });
    const loaded = jobsLoadSucceeded(withEvent, [job('job-1', 'queued')]);

    expect(loaded.jobs).toEqual([eventJob]);
    expect(loaded.eventsDuringLoad).toEqual({});
  });

  it('does not regress a job from an older event', () => {
    const newer = {
      ...job('job-1', 'succeeded'),
      updatedAt: '2026-04-29T00:02:00.000Z',
    };
    const state = jobsLoadSucceeded(createInitialJobsState(), [newer]);
    const updated = jobsEventReceived(state, {
      job: { ...job('job-1', 'running'), updatedAt: '2026-04-29T00:01:00.000Z' },
      type: 'job-updated',
    });

    expect(updated.jobs).toEqual([newer]);
  });
});

const deleteRequest: FirestoreCollectionJobRequest = {
  collectionPath: 'orders',
  connectionId: 'emu',
  includeSubcollections: false,
  type: 'firestore.deleteCollection',
};

function job(id: string, status: BackgroundJob['status']): BackgroundJob {
  return {
    createdAt: '2026-04-29T00:00:00.000Z',
    id,
    progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
    request: deleteRequest,
    status,
    title: 'Delete collection',
    type: 'firestore.deleteCollection',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}
