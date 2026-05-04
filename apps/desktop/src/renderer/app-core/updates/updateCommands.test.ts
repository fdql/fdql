import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type HotkeyOverrides,
  type SettingsPatch,
  type SettingsRepository,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  checkForUpdatesCommand,
  dismissUpdateCommand,
  openUpdateReleaseCommand,
} from './updateCommands.ts';
import { createUpdateStore } from './updateStore.ts';

describe('update commands', () => {
  it('skips startup checks until the daily interval expires', async () => {
    const store = createUpdateStore();
    const settings = new MemorySettingsRepository({
      updates: { dismissedVersion: null, lastCheckedAt: '2026-05-04T00:00:00.000Z' },
    });
    const checkForUpdates = vi.fn();

    await checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T12:00:00.000Z'),
      settings,
      updateApi: { checkForUpdates },
    });

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(store.get().status).toBe('idle');
  });

  it('lets manual checks bypass the daily interval', async () => {
    const store = createUpdateStore();
    const settings = new MemorySettingsRepository({
      updates: { dismissedVersion: null, lastCheckedAt: '2026-05-04T00:00:00.000Z' },
    });
    const checkForUpdates = vi.fn(async () => currentResult());
    const onStatus = vi.fn();

    await checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T12:00:00.000Z'),
      onStatus,
      settings,
      updateApi: { checkForUpdates },
    }, { force: true });

    expect(checkForUpdates).toHaveBeenCalledWith({ force: true });
    expect(store.get()).toMatchObject({ checkedManually: true, status: 'current' });
    expect(onStatus).toHaveBeenCalledWith('Firebase Desk 0.0.6 is current');
  });

  it('does not start overlapping update checks', async () => {
    const store = createUpdateStore();
    const settings = new MemorySettingsRepository();
    const loadSnapshot = settings.load.bind(settings);
    const loadResolvers: Array<(snapshot: SettingsSnapshot) => void> = [];
    settings.load = vi.fn(() =>
      new Promise<SettingsSnapshot>((resolve) => loadResolvers.push(resolve))
    );
    let finishCheck: ((result: ReturnType<typeof currentResult>) => void) | null = null;
    const checkForUpdates = vi.fn(() =>
      new Promise<ReturnType<typeof currentResult>>((resolve) => {
        finishCheck = resolve;
      })
    );

    const first = checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T12:00:00.000Z'),
      settings,
      updateApi: { checkForUpdates },
    }, { force: true });
    const second = checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T12:00:00.000Z'),
      settings,
      updateApi: { checkForUpdates },
    }, { force: true });

    loadResolvers[0]!(await loadSnapshot());
    await Promise.resolve();
    expect(store.get().status).toBe('checking');
    loadResolvers[1]!(await loadSnapshot());
    await Promise.resolve();

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    settings.load = loadSnapshot;
    finishCheck!(currentResult());
    await Promise.all([first, second]);
    expect(store.get().status).toBe('current');
  });

  it('hides an available update dismissed for the same version', async () => {
    const store = createUpdateStore();
    const settings = new MemorySettingsRepository({
      updates: { dismissedVersion: '0.0.7', lastCheckedAt: null },
    });

    await checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T00:00:00.000Z'),
      settings,
      updateApi: { checkForUpdates: vi.fn(async () => availableResult()) },
    });

    expect(store.get()).toEqual({ dismissedVersion: '0.0.7', status: 'dismissed' });
  });

  it('persists dismissed available versions', async () => {
    const store = createUpdateStore();
    const settings = new MemorySettingsRepository();
    await checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T00:00:00.000Z'),
      settings,
      updateApi: { checkForUpdates: vi.fn(async () => availableResult()) },
    });

    await dismissUpdateCommand(store, { settings });

    expect(store.get()).toEqual({ dismissedVersion: '0.0.7', status: 'dismissed' });
    await expect(settings.load()).resolves.toMatchObject({
      updates: { dismissedVersion: '0.0.7' },
    });
  });

  it('surfaces failed checks and records activity', async () => {
    const store = createUpdateStore();
    const settings = new MemorySettingsRepository();
    const onStatus = vi.fn();
    const recordActivity = vi.fn();

    await checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T00:00:00.000Z'),
      onStatus,
      recordActivity,
      settings,
      updateApi: {
        checkForUpdates: vi.fn(async () => ({
          checkedAt: '2026-05-04T00:00:00.000Z',
          message: 'network down',
          status: 'failed' as const,
        })),
      },
    }, { force: true });

    expect(store.get()).toEqual({
      checkedAt: '2026-05-04T00:00:00.000Z',
      message: 'network down',
      status: 'failed',
    });
    expect(onStatus).toHaveBeenCalledWith('Update check failed: network down');
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Check for updates',
      status: 'failure',
      summary: 'network down',
    }));
  });

  it('opens the release page for available updates', async () => {
    const store = createUpdateStore();
    const settings = new MemorySettingsRepository();
    const openExternalUrl = vi.fn();
    await checkForUpdatesCommand(store, {
      now: () => Date.parse('2026-05-04T00:00:00.000Z'),
      settings,
      updateApi: { checkForUpdates: vi.fn(async () => availableResult()) },
    });

    await openUpdateReleaseCommand(store, { updateApi: { openExternalUrl } });

    expect(openExternalUrl).toHaveBeenCalledWith({
      url: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
    });
  });
});

function availableResult() {
  return {
    checkedAt: '2026-05-04T00:00:00.000Z',
    currentVersion: '0.0.6',
    latestVersion: '0.0.7',
    releaseUrl: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
    status: 'available' as const,
  };
}

function currentResult() {
  return {
    ...availableResult(),
    latestVersion: '0.0.6',
    status: 'current' as const,
  };
}

class MemorySettingsRepository implements SettingsRepository {
  private snapshot: SettingsSnapshot = {
    activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
    dataMode: 'mock',
    density: 'compact',
    firestoreFieldCatalogs: {},
    firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
    hotkeyOverrides: {},
    inspectorWidth: 360,
    resultTableLayouts: {},
    sidebarWidth: 320,
    theme: 'system',
    updates: DEFAULT_UPDATE_SETTINGS,
    workspaceState: null,
  };

  constructor(patch: Pick<SettingsPatch, 'updates'> = {}) {
    this.snapshot = {
      ...this.snapshot,
      updates: patch.updates ?? this.snapshot.updates,
    };
  }

  async load(): Promise<SettingsSnapshot> {
    return structuredClone(this.snapshot);
  }

  async save(patch: SettingsPatch): Promise<SettingsSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      updates: patch.updates ?? this.snapshot.updates,
    };
    return this.load();
  }

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return this.snapshot.hotkeyOverrides;
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    this.snapshot = { ...this.snapshot, hotkeyOverrides: overrides };
  }
}
