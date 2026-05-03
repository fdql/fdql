import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import { describe, expect, it } from 'vitest';
import {
  backgroundJobNotificationForEvent,
  isInternalAppNavigation,
  nativeContextMenuActions,
  shouldOpenExternally,
} from './native-app-policy.ts';

describe('native app policy', () => {
  it('opens only external links outside the app shell', () => {
    expect(shouldOpenExternally('https://firebase.google.com/docs', 'file:///app/index.html'))
      .toBe(true);
    expect(shouldOpenExternally('https://docs.example/path', 'https://app.example/shell'))
      .toBe(true);
    expect(shouldOpenExternally('https://app.example/next', 'https://app.example/shell'))
      .toBe(false);
    expect(shouldOpenExternally('mailto:team@example.com', 'https://app.example/shell')).toBe(true);
    expect(shouldOpenExternally('file:///tmp/data.json', 'file:///app/index.html')).toBe(false);
  });

  it('allows only app shell navigation internally', () => {
    expect(isInternalAppNavigation('file:///app/index.html#/settings', 'file:///app/index.html'))
      .toBe(true);
    expect(isInternalAppNavigation('file:///tmp/data.json', 'file:///app/index.html')).toBe(
      false,
    );
    expect(isInternalAppNavigation('https://app.example/next', 'https://app.example/shell'))
      .toBe(true);
    expect(isInternalAppNavigation('about:blank', 'https://app.example/shell')).toBe(false);
  });

  it('uses native edit actions for editable context menus', () => {
    expect(nativeContextMenuActions({ isEditable: true }, false)).toEqual([
      'cut',
      'copy',
      'paste',
      'paste-and-match-style',
      'separator',
      'delete',
      'select-all',
    ]);
  });

  it('keeps inspect actions development-only', () => {
    expect(nativeContextMenuActions({ isEditable: false, selectionText: 'abc' }, false)).toEqual([
      'copy',
    ]);
    expect(nativeContextMenuActions({ isEditable: false, selectionText: 'abc' }, true)).toEqual([
      'copy',
      'separator',
      'inspect',
    ]);
  });

  it('creates notifications only for final background job updates', () => {
    expect(backgroundJobNotificationForEvent({ job: job('running'), type: 'job-updated' })).toBe(
      null,
    );
    expect(backgroundJobNotificationForEvent({ job: job('succeeded'), type: 'job-added' })).toBe(
      null,
    );
    expect(backgroundJobNotificationForEvent({ job: job('succeeded'), type: 'job-updated' }))
      .toEqual({
        body: 'Exported 2 rows.',
        jobId: 'job-1',
        title: 'Export collection succeeded',
      });
    expect(
      backgroundJobNotificationForEvent({
        job: { ...job('failed'), error: { message: 'Permission denied' } },
        type: 'job-updated',
      }),
    ).toMatchObject({
      body: 'Permission denied',
      title: 'Export collection failed',
    });
    expect(
      backgroundJobNotificationForEvent({
        job: { ...job('failed'), acknowledgedAt: '2026-05-01T00:02:00.000Z' },
        type: 'job-updated',
      }),
    ).toBe(null);
  });
});

function job(status: BackgroundJob['status']): BackgroundJob {
  return {
    createdAt: '2026-05-01T00:00:00.000Z',
    id: 'job-1',
    progress: { deleted: 0, failed: 0, read: 2, skipped: 0, written: 0 },
    request: {
      collectionPath: 'orders',
      connectionId: 'demo',
      encoding: 'encoded',
      filePath: '/tmp/orders.jsonl',
      format: 'jsonl',
      includeSubcollections: false,
      type: 'firestore.exportCollection',
    },
    status,
    summary: 'Exported 2 rows.',
    ...(status === 'running' ? {} : { finishedAt: '2026-05-01T00:01:00.000Z' }),
    title: 'Export collection',
    type: 'firestore.exportCollection',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}
