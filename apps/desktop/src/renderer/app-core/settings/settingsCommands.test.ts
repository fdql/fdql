import type {
  HotkeyOverrides,
  SettingsPatch,
  SettingsRepository,
  SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
} from '@firebase-desk/repo-contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  changeAppearanceModeCommand,
  changeDensityCommand,
  loadDataDirectoryPathCommand,
  openDataDirectoryCommand,
  recordSettingsSavedCommand,
} from './settingsCommands.ts';
import { settingsPatchMetadata, settingsPatchSummary } from './settingsSelectors.ts';

describe('settings core', () => {
  it('summarizes data mode, activity, Firestore write, and theme patches', () => {
    const activityPatch: SettingsPatch = {
      activityLog: { detailMode: 'fullPayload', enabled: true, maxBytes: 8 },
    };
    const firestorePatch: SettingsPatch = {
      firestoreWrites: { fieldStaleBehavior: 'block' },
    };

    expect(settingsPatchSummary({ dataMode: 'live' })).toBe('Data mode changed to live');
    expect(settingsPatchSummary({ density: 'comfortable' })).toBe(
      'Density changed to comfortable',
    );
    expect(settingsPatchSummary(activityPatch)).toBe('Activity settings changed');
    expect(settingsPatchSummary(firestorePatch)).toBe('Firestore write settings changed');
    expect(settingsPatchSummary({ theme: 'dark' })).toBe('Theme changed to dark');
    expect(settingsPatchMetadata(activityPatch)).toMatchObject({
      activityLog: { detailMode: 'fullPayload', enabled: true, maxBytes: 8 },
      changedKeys: ['activityLog'],
    });
    expect(settingsPatchMetadata(firestorePatch)).toMatchObject({
      changedKeys: ['firestoreWrites'],
      firestoreWrites: { fieldStaleBehavior: 'block' },
    });
    expect(settingsPatchMetadata({ density: 'comfortable' })).toMatchObject({
      changedKeys: ['density'],
      density: 'comfortable',
    });
  });

  it('records theme changes as settings activity', async () => {
    const recordActivity = vi.fn();
    await changeAppearanceModeCommand(
      { now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(25), recordActivity },
      { mode: 'dark', setMode: vi.fn(async () => {}) },
    );

    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'Change theme',
        area: 'settings',
        durationMs: 15,
        metadata: { mode: 'dark' },
        status: 'success',
        summary: 'Theme changed to dark',
      }),
    );
  });

  it('records theme failures without throwing', async () => {
    const recordActivity = vi.fn();
    const onStatus = vi.fn();
    await changeAppearanceModeCommand(
      {
        now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(12),
        onStatus,
        recordActivity,
      },
      { mode: 'light', setMode: vi.fn(async () => Promise.reject(new Error('Disk full'))) },
    );

    expect(onStatus).toHaveBeenCalledWith('Theme failed: Disk full');
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { message: 'Disk full' },
        status: 'failure',
        summary: 'Disk full',
      }),
    );
  });

  it('persists density changes and records activity', async () => {
    const recordActivity = vi.fn();
    const setDensity = vi.fn();
    const settings = new DensitySettingsRepository();

    await changeDensityCommand(
      { now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(18), recordActivity },
      {
        density: 'comfortable',
        settings,
        setDensity,
      },
    );

    expect(settings.save).toHaveBeenCalledWith({ density: 'comfortable' });
    expect(setDensity).toHaveBeenCalledWith('comfortable');
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'Change density',
        durationMs: 8,
        metadata: { density: 'comfortable' },
        status: 'success',
      }),
    );
  });

  it('records saved settings patches', () => {
    const recordActivity = vi.fn();
    recordSettingsSavedCommand(
      { recordActivity },
      { firestoreWrites: { fieldStaleBehavior: 'confirm' } },
    );

    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'Update settings',
        area: 'settings',
        metadata: {
          changedKeys: ['firestoreWrites'],
          firestoreWrites: { fieldStaleBehavior: 'confirm' },
        },
        status: 'success',
        summary: 'Firestore write settings changed',
      }),
    );
  });

  it('loads and opens the desktop data directory through the app API', async () => {
    const openDataDirectory = vi.fn(async () => {});
    const onStatus = vi.fn();
    const api = {
      getConfig: vi.fn(async () => ({ dataDirectory: '/tmp/firebase-desk' })),
      openDataDirectory,
    };

    await expect(loadDataDirectoryPathCommand(api)).resolves.toBe('/tmp/firebase-desk');
    await openDataDirectoryCommand({ onStatus }, api);

    expect(openDataDirectory).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('Opened data location');
  });

  it('treats unavailable data directory APIs as null or errors', async () => {
    await expect(loadDataDirectoryPathCommand(null)).resolves.toBeNull();
    await expect(openDataDirectoryCommand({}, null)).rejects.toThrow(
      'Data location is unavailable.',
    );
  });
});

class DensitySettingsRepository implements SettingsRepository {
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

  readonly load = vi.fn(async (): Promise<SettingsSnapshot> => this.snapshot);

  readonly save = vi.fn(async (patch: SettingsPatch): Promise<SettingsSnapshot> => {
    this.snapshot = {
      ...this.snapshot,
      density: patch.density ?? this.snapshot.density,
    };
    return this.snapshot;
  });

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return this.snapshot.hotkeyOverrides;
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    this.snapshot = { ...this.snapshot, hotkeyOverrides: overrides };
  }
}
