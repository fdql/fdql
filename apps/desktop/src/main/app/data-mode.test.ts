import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { describe, expect, it } from 'vitest';
import { readDataModeSwitch, resolveDataMode } from './data-mode.ts';

const snapshot: SettingsSnapshot = {
  activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
  sidebarWidth: 320,
  inspectorWidth: 360,
  theme: 'system',
  density: 'compact',
  dataMode: 'mock',
  hotkeyOverrides: {},
  resultTableLayouts: {},
  firestoreFieldCatalogs: {},
  firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
  updates: DEFAULT_UPDATE_SETTINGS,
  workspaceState: null,
};

describe('data mode config', () => {
  it('reads explicit CLI data-mode switches', () => {
    expect(readDataModeSwitch(['electron', '--data-mode=mock'])).toBe('mock');
    expect(readDataModeSwitch(['electron', '--data-mode=live'])).toBe('live');
    expect(readDataModeSwitch(['electron', '--mock'])).toBe('mock');
    expect(readDataModeSwitch(['electron', '--live'])).toBe('live');
  });

  it('ignores invalid CLI values', () => {
    expect(readDataModeSwitch(['electron', '--data-mode=other'])).toBeNull();
  });

  it('prefers CLI over saved settings', async () => {
    await expect(
      resolveDataMode({ load: async () => snapshot }, ['electron', '--data-mode=live']),
    ).resolves.toEqual({ dataMode: 'live' });
  });

  it('falls back to saved settings', async () => {
    await expect(resolveDataMode({ load: async () => snapshot }, ['electron'])).resolves.toEqual({
      dataMode: 'mock',
    });
  });
});
