import type {
  ActivityLogSettings,
  HotkeyOverrides,
  SettingsPatch,
  SettingsRepository,
  SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_DENSITY,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  normalizeFirestoreWriteSettings,
} from '@firebase-desk/repo-contracts';

const DEFAULT_SNAPSHOT: SettingsSnapshot = {
  activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
  sidebarWidth: 320,
  inspectorWidth: 360,
  theme: 'system',
  density: DEFAULT_DENSITY,
  dataMode: 'mock',
  hotkeyOverrides: {},
  resultTableLayouts: {},
  firestoreFieldCatalogs: {},
  firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
  updates: DEFAULT_UPDATE_SETTINGS,
  workspaceState: null,
};

export class MockSettingsRepository implements SettingsRepository {
  private snapshot: SettingsSnapshot = { ...DEFAULT_SNAPSHOT };

  async load(): Promise<SettingsSnapshot> {
    return cloneSnapshot(this.snapshot);
  }

  async save(patch: SettingsPatch): Promise<SettingsSnapshot> {
    this.snapshot = {
      activityLog: patch.activityLog ? cloneActivityLogSettings(patch.activityLog) : {
        ...this.snapshot.activityLog,
      },
      sidebarWidth: patch.sidebarWidth ?? this.snapshot.sidebarWidth,
      inspectorWidth: patch.inspectorWidth ?? this.snapshot.inspectorWidth,
      theme: patch.theme ?? this.snapshot.theme,
      density: patch.density ?? this.snapshot.density,
      dataMode: patch.dataMode ?? this.snapshot.dataMode,
      hotkeyOverrides: patch.hotkeyOverrides
        ? { ...patch.hotkeyOverrides }
        : { ...this.snapshot.hotkeyOverrides },
      resultTableLayouts: patch.resultTableLayouts
        ? cloneResultTableLayouts(patch.resultTableLayouts)
        : cloneResultTableLayouts(this.snapshot.resultTableLayouts),
      firestoreFieldCatalogs: patch.firestoreFieldCatalogs
        ? cloneFirestoreFieldCatalogs(patch.firestoreFieldCatalogs)
        : cloneFirestoreFieldCatalogs(this.snapshot.firestoreFieldCatalogs),
      firestoreWrites: normalizeFirestoreWriteSettings(
        patch.firestoreWrites ?? this.snapshot.firestoreWrites,
      ),
      updates: patch.updates ? { ...patch.updates } : { ...this.snapshot.updates },
      workspaceState: patch.workspaceState === undefined
        ? cloneWorkspaceState(this.snapshot.workspaceState)
        : cloneWorkspaceState(patch.workspaceState),
    };
    return this.load();
  }

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return { ...this.snapshot.hotkeyOverrides };
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    this.snapshot = { ...this.snapshot, hotkeyOverrides: { ...overrides } };
  }
}

function cloneSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
  return {
    ...snapshot,
    activityLog: cloneActivityLogSettings(snapshot.activityLog),
    density: snapshot.density ?? DEFAULT_DENSITY,
    hotkeyOverrides: { ...snapshot.hotkeyOverrides },
    resultTableLayouts: cloneResultTableLayouts(snapshot.resultTableLayouts),
    firestoreFieldCatalogs: cloneFirestoreFieldCatalogs(snapshot.firestoreFieldCatalogs),
    firestoreWrites: normalizeFirestoreWriteSettings(snapshot.firestoreWrites),
    updates: { ...snapshot.updates },
    workspaceState: cloneWorkspaceState(snapshot.workspaceState),
  };
}

function cloneWorkspaceState(value: unknown | null): unknown | null {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function cloneActivityLogSettings(settings: ActivityLogSettings): ActivityLogSettings {
  return { ...settings };
}

function cloneResultTableLayouts(
  layouts: SettingsSnapshot['resultTableLayouts'],
): SettingsSnapshot['resultTableLayouts'] {
  return Object.fromEntries(
    Object.entries(layouts).map(([key, value]) => [
      key,
      {
        columnOrder: [...value.columnOrder],
        columnSizing: { ...value.columnSizing },
      },
    ]),
  );
}

function cloneFirestoreFieldCatalogs(
  catalogs: SettingsSnapshot['firestoreFieldCatalogs'],
): SettingsSnapshot['firestoreFieldCatalogs'] {
  return Object.fromEntries(
    Object.entries(catalogs).map(([key, entries]) => [
      key,
      entries.map((entry) => ({
        count: entry.count,
        field: entry.field,
        types: [...entry.types],
      })),
    ]),
  );
}
