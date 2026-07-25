import type {
  BackgroundJob,
  BackgroundJobEvent,
  BackgroundJobRepository,
  FirestoreCollectionJobRequest,
  FirestoreExportFormat,
} from '@firebase-desk/repo-contracts/jobs';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialJobsState } from './jobsState.ts';
import { createJobsStore } from './jobsStore.ts';
import { useJobsController } from './useJobsController.ts';

describe('useJobsController', () => {
  it('loads jobs and reacts to repository events', async () => {
    const repository = new FakeJobsRepository([job('job-1', 'running')]);
    const store = createJobsStore();
    const { result } = renderHook(() => useJobsController({ repository, store }));

    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    expect(result.current.button).toMatchObject({
      badge: { label: '1', variant: 'warning' },
      variant: 'secondary',
    });

    act(() => {
      repository.emit({ job: job('job-2', 'failed'), type: 'job-added' });
    });

    expect(result.current.jobs.map((entry) => entry.id)).toEqual(['job-2', 'job-1']);
    expect(result.current.button).toMatchObject({
      badge: { label: '1', variant: 'danger' },
      variant: 'warning',
    });

    act(() => {
      result.current.open();
    });

    expect(result.current.button).toMatchObject({
      badge: { label: '1', variant: 'warning' },
      variant: 'secondary',
    });
    expect(repository.acknowledged).toEqual([['job-2']]);
  });

  it('persists failed job acknowledgement after loading while drawer is open', async () => {
    const repository = new FakeJobsRepository([job('job-1', 'failed')]);
    const store = createJobsStore(createInitialJobsState({ open: true }));
    renderHook(() => useJobsController({ repository, store }));

    await waitFor(() => expect(repository.acknowledged).toEqual([['job-1']]));
  });

  it('starts, cancels, and clears through the repository with status updates', async () => {
    const repository = new FakeJobsRepository([]);
    const onStatus = vi.fn();
    const store = createJobsStore();
    const { result } = renderHook(() => useJobsController({ onStatus, repository, store }));

    await act(async () => {
      await result.current.start(deleteRequest);
    });
    result.current.cancel('job-new');
    result.current.clearCompleted();

    expect(repository.started).toEqual([deleteRequest]);
    expect(repository.cancelled).toEqual(['job-new']);
    expect(repository.clearCompletedCount).toBe(1);
    expect(onStatus).toHaveBeenCalledWith('Queued delete collection');
  });

  it('reports successful job events to result-scope invalidation', async () => {
    const repository = new FakeJobsRepository([]);
    const onJobSucceeded = vi.fn();
    renderHook(() => useJobsController({ onJobSucceeded, repository }));
    await waitFor(() => expect(repository.listeners.size).toBe(1));
    const succeeded = job('job-1', 'succeeded');

    act(() => repository.emit({ job: succeeded, type: 'job-updated' }));

    expect(onJobSucceeded).toHaveBeenCalledWith(succeeded);
  });
});

class FakeJobsRepository implements BackgroundJobRepository {
  readonly acknowledged: string[][] = [];
  readonly cancelled: string[] = [];
  readonly listeners = new Set<(event: BackgroundJobEvent) => void>();
  readonly started: FirestoreCollectionJobRequest[] = [];
  clearCompletedCount = 0;

  constructor(private readonly rows: ReadonlyArray<BackgroundJob>) {}

  async acknowledgeIssues(ids: ReadonlyArray<string>): Promise<void> {
    this.acknowledged.push(Array.from(ids));
  }

  async cancel(id: string): Promise<void> {
    this.cancelled.push(id);
  }

  async clearCompleted(): Promise<void> {
    this.clearCompletedCount += 1;
  }

  async list(): Promise<ReadonlyArray<BackgroundJob>> {
    return this.rows;
  }

  async pickExportFile(format: FirestoreExportFormat) {
    return { canceled: false, filePath: `/tmp/export.${format}` };
  }

  async pickImportFile() {
    return { canceled: false, filePath: '/tmp/import.jsonl' };
  }

  async start(request: FirestoreCollectionJobRequest): Promise<BackgroundJob> {
    this.started.push(request);
    const queued = job('job-new', 'queued');
    this.emit({ job: queued, type: 'job-added' });
    return queued;
  }

  subscribe(listener: (event: BackgroundJobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: BackgroundJobEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

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
