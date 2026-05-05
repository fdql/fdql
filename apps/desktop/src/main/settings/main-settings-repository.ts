import type {
  ActivityLogSettings,
  HotkeyOverrides,
  SettingsPatch,
  SettingsRepository,
  SettingsSnapshot,
  UpdateSettings,
} from '@firebase-desk/repo-contracts';
import { DEFAULT_DENSITY, normalizeFirestoreWriteSettings } from '@firebase-desk/repo-contracts';

interface SettingsStoreLike {
  readonly load: () => Promise<SettingsSnapshot>;
  readonly save: (snapshot: SettingsSnapshot) => Promise<SettingsSnapshot>;
}

export class MainSettingsRepository implements SettingsRepository {
  private readonly store: SettingsStoreLike;

  constructor(store: SettingsStoreLike) {
    this.store = store;
  }

  async load(): Promise<SettingsSnapshot> {
    return await this.store.load();
  }

  async save(patch: SettingsPatch): Promise<SettingsSnapshot> {
    const current = await this.store.load();
    return await this.store.save({
      activityLog: patch.activityLog
        ? cloneActivityLogSettings(patch.activityLog)
        : cloneActivityLogSettings(current.activityLog),
      sidebarWidth: patch.sidebarWidth ?? current.sidebarWidth,
      inspectorWidth: patch.inspectorWidth ?? current.inspectorWidth,
      theme: patch.theme ?? current.theme,
      density: patch.density ?? current.density ?? DEFAULT_DENSITY,
      dataMode: patch.dataMode ?? current.dataMode,
      firstRunGuide: patch.firstRunGuide
        ? cloneFirstRunGuideSettings(patch.firstRunGuide)
        : cloneFirstRunGuideSettings(current.firstRunGuide),
      hotkeyOverrides: patch.hotkeyOverrides
        ? { ...patch.hotkeyOverrides }
        : { ...current.hotkeyOverrides },
      resultTableLayouts: patch.resultTableLayouts
        ? cloneResultTableLayouts(patch.resultTableLayouts)
        : cloneResultTableLayouts(current.resultTableLayouts),
      firestoreFieldCatalogs: patch.firestoreFieldCatalogs
        ? cloneFirestoreFieldCatalogs(patch.firestoreFieldCatalogs)
        : cloneFirestoreFieldCatalogs(current.firestoreFieldCatalogs),
      firestoreWrites: normalizeFirestoreWriteSettings(
        patch.firestoreWrites ?? current.firestoreWrites,
      ),
      updates: patch.updates
        ? cloneUpdateSettings(patch.updates)
        : cloneUpdateSettings(current.updates),
      workspaceState: patch.workspaceState === undefined
        ? cloneWorkspaceState(current.workspaceState)
        : cloneWorkspaceState(patch.workspaceState),
    });
  }

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return (await this.load()).hotkeyOverrides;
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    await this.save({ hotkeyOverrides: { ...overrides } });
  }
}

function cloneWorkspaceState(value: unknown | null): unknown | null {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function cloneActivityLogSettings(settings: ActivityLogSettings): ActivityLogSettings {
  return { ...settings };
}

function cloneFirstRunGuideSettings(
  settings: SettingsSnapshot['firstRunGuide'] | null | undefined,
): SettingsSnapshot['firstRunGuide'] {
  return { completedAt: settings?.completedAt ?? null };
}

function cloneUpdateSettings(settings: UpdateSettings): UpdateSettings {
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
