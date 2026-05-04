import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JobsDrawer } from './JobsDrawer.tsx';

describe('JobsDrawer', () => {
  it('renders job progress and emits cancel/clear/expand actions', () => {
    const onCancel = vi.fn();
    const onClearCompleted = vi.fn();
    const onExpandedChange = vi.fn();
    render(
      <JobsDrawer
        jobs={[job]}
        open
        onCancel={onCancel}
        onClearCompleted={onClearCompleted}
        onClose={vi.fn()}
        onExpandedChange={onExpandedChange}
      />,
    );

    const drawer = screen.getByRole('region', { name: 'Jobs' });
    expect(drawer.className).toContain('grid-rows-[auto_minmax(0,1fr)]');
    expect(screen.getByText('Copy collection')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear completed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(onClearCompleted).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith('job-1');
  });

  it('keeps the header pinned above the scrollable body when expanded', () => {
    render(
      <JobsDrawer
        expanded
        jobs={[job]}
        open
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onClose={vi.fn()}
        onExpandedChange={vi.fn()}
      />,
    );

    const drawer = screen.getByRole('region', { name: 'Jobs' });
    expect(drawer.className).toContain('grid-rows-[auto_minmax(0,1fr)]');
    expect(drawer.className).toContain('h-[70vh]');
  });

  it('closes on Escape from inside the drawer', () => {
    const onClose = vi.fn();
    render(
      <JobsDrawer
        jobs={[job]}
        open
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onClose={onClose}
        onExpandedChange={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Clear completed' }), {
      key: 'Escape',
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not double-count skipped or failed rows in progress', () => {
    render(
      <JobsDrawer
        jobs={[{
          ...job,
          progress: { deleted: 0, failed: 1, read: 3, skipped: 1, written: 1 },
          status: 'succeeded',
        }]}
        open
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onClose={vi.fn()}
        onExpandedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('progressbar', { name: 'Copy collection progress' }).getAttribute(
        'aria-valuenow',
      ),
    ).toBe('100');
  });

  it('uses total counts for active job progress', () => {
    render(
      <JobsDrawer
        jobs={[{
          ...job,
          progress: { deleted: 0, failed: 0, read: 4, skipped: 1, total: 10, written: 3 },
        }]}
        open
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onClose={vi.fn()}
        onExpandedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('progressbar', { name: 'Copy collection progress' }).getAttribute(
        'aria-valuenow',
      ),
    ).toBe('40');
    expect(screen.getByText('total 10')).toBeTruthy();
  });

  it('uses reads as export progress', () => {
    render(
      <JobsDrawer
        jobs={[{
          ...job,
          progress: { deleted: 0, failed: 0, read: 5, skipped: 0, total: 10, written: 0 },
          title: 'Export collection',
          type: 'firestore.exportCollection',
        }]}
        open
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        onClose={vi.fn()}
        onExpandedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('progressbar', { name: 'Export collection progress' }).getAttribute(
        'aria-valuenow',
      ),
    ).toBe('50');
  });
});

const job: BackgroundJob = {
  createdAt: '2026-04-29T00:00:00.000Z',
  id: 'job-1',
  progress: { currentPath: 'orders/ord_1', deleted: 0, failed: 0, read: 1, skipped: 0, written: 1 },
  request: {
    collisionPolicy: 'skip',
    includeSubcollections: false,
    sourceCollectionPath: 'orders',
    sourceConnectionId: 'emu',
    targetCollectionPath: 'orders_copy',
    targetConnectionId: 'emu',
    type: 'firestore.copyCollection',
  },
  status: 'running',
  title: 'Copy collection',
  type: 'firestore.copyCollection',
  updatedAt: '2026-04-29T00:00:01.000Z',
};
