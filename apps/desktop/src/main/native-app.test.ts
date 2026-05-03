import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import { type BrowserWindow, shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundJobNotifier, installNativeWindowBehavior } from './native-app.ts';

type ShowNotification = NonNullable<
  Parameters<typeof createBackgroundJobNotifier>[0]
>['showNotification'];

vi.mock('electron', () => ({
  app: { isPackaged: true, name: 'Firebase Desk' },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { themeSource: 'system' },
  Notification: { isSupported: vi.fn(() => true) },
  shell: { openExternal: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('native window behavior', () => {
  it('denies popups while opening external popup URLs in the browser', () => {
    const externalUrl = 'https://firebase.google.com/docs';
    const harness = nativeWindowHarness('file:///app/index.html');
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);

    installNativeWindowBehavior(harness.window);

    expect(harness.openWindow(externalUrl)).toEqual({ action: 'deny' });
    expect(harness.openWindow('file:///app/index.html#/settings')).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledWith(externalUrl);
  });

  it('blocks non-app navigations and opens external navigations in the browser', () => {
    const externalUrl = 'https://firebase.google.com/docs';
    const harness = nativeWindowHarness('file:///app/index.html');
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);

    installNativeWindowBehavior(harness.window);

    expect(harness.navigate('file:///app/index.html#/settings').preventDefault).not
      .toHaveBeenCalled();
    expect(harness.navigate('about:blank').preventDefault).toHaveBeenCalled();
    expect(harness.navigate(externalUrl).preventDefault).toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledWith(externalUrl);
  });
});

describe('background job notifier', () => {
  it('dedupes final job notifications', () => {
    const showNotification = vi.fn<ShowNotification>();
    const notify = notifier(showNotification);

    notify({ job: job('job-1'), type: 'job-updated' });
    notify({ job: job('job-1'), type: 'job-updated' });

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('forgets removed jobs', () => {
    const showNotification = vi.fn<ShowNotification>();
    const notify = notifier(showNotification);

    notify({ job: job('job-1'), type: 'job-updated' });
    notify({ id: 'job-1', type: 'job-removed' });
    notify({ job: job('job-1'), type: 'job-updated' });

    expect(showNotification).toHaveBeenCalledTimes(2);
  });

  it('forgets acknowledged jobs', () => {
    const showNotification = vi.fn<ShowNotification>();
    const notify = notifier(showNotification);

    notify({ job: job('job-1'), type: 'job-updated' });
    notify({
      job: { ...job('job-1'), acknowledgedAt: '2026-05-01T00:02:00.000Z' },
      type: 'job-updated',
    });
    notify({ job: job('job-1'), type: 'job-updated' });

    expect(showNotification).toHaveBeenCalledTimes(2);
  });

  it('bounds remembered job ids', () => {
    const showNotification = vi.fn<ShowNotification>();
    const notify = notifier(showNotification);

    for (let index = 0; index <= 500; index += 1) {
      notify({ job: job(`job-${index}`), type: 'job-updated' });
    }
    notify({ job: job('job-0'), type: 'job-updated' });

    expect(showNotification).toHaveBeenCalledTimes(502);
  });
});

type WindowOpenHandler = Parameters<BrowserWindow['webContents']['setWindowOpenHandler']>[0];
type WillNavigateHandler = (
  event: { readonly preventDefault: () => void; },
  url: string,
) => void;

function nativeWindowHarness(currentUrl: string): {
  readonly navigate: (url: string) => { readonly preventDefault: ReturnType<typeof vi.fn>; };
  readonly openWindow: (url: string) => ReturnType<WindowOpenHandler>;
  readonly window: BrowserWindow;
} {
  let openHandler: WindowOpenHandler | null = null;
  let willNavigateHandler: WillNavigateHandler | null = null;
  const webContents = {
    getURL: vi.fn(() => currentUrl),
    inspectElement: vi.fn(),
    on: vi.fn((event: string, handler: WillNavigateHandler) => {
      if (event === 'will-navigate') willNavigateHandler = handler;
    }),
    setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
      openHandler = handler;
    }),
  };
  return {
    navigate: (url) => {
      if (!willNavigateHandler) throw new Error('will-navigate handler missing');
      const event = { preventDefault: vi.fn() };
      willNavigateHandler(event, url);
      return event;
    },
    openWindow: (url) => {
      if (!openHandler) throw new Error('window open handler missing');
      return openHandler({ url } as Parameters<WindowOpenHandler>[0]);
    },
    window: { webContents } as unknown as BrowserWindow,
  };
}

function notifier(
  showNotification: ShowNotification,
): ReturnType<typeof createBackgroundJobNotifier> {
  return createBackgroundJobNotifier({
    focusApp: vi.fn(),
    isAppFocused: () => false,
    isNotificationSupported: () => true,
    showNotification,
  });
}

function job(id: string): BackgroundJob {
  return {
    createdAt: '2026-05-01T00:00:00.000Z',
    finishedAt: '2026-05-01T00:01:00.000Z',
    id,
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
    status: 'succeeded',
    summary: 'Exported 2 rows.',
    title: 'Export collection',
    type: 'firestore.exportCollection',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}
