import { SettingsFileSchema } from '@firebase-desk/ipc-schemas';
import {
  type ActivityLogSettings,
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_DENSITY,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_FIRST_RUN_GUIDE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  normalizeFirestoreWriteSettings,
  type SettingsSnapshot,
  type UpdateSettings,
} from '@firebase-desk/repo-contracts';
import { readFile, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.ts';

export const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
  sidebarWidth: 320,
  inspectorWidth: 360,
  theme: 'system',
  density: DEFAULT_DENSITY,
  dataMode: 'mock',
  firstRunGuide: DEFAULT_FIRST_RUN_GUIDE_SETTINGS,
  hotkeyOverrides: {},
  resultTableLayouts: {},
  firestoreFieldCatalogs: {},
  firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
  updates: DEFAULT_UPDATE_SETTINGS,
  workspaceState: null,
};

export class SettingsStore {
  private readonly filePath: string;
  private cache: SettingsSnapshot | null = null;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'settings.json');
  }

  async load(): Promise<SettingsSnapshot> {
    if (this.cache) return cloneSnapshot(this.cache);
    this.cache = await this.readFile();
    return cloneSnapshot(this.cache);
  }

  async save(snapshot: SettingsSnapshot): Promise<SettingsSnapshot> {
    this.cache = cloneSnapshot(snapshot);
    await writeJsonAtomic(this.filePath, { version: 1, snapshot: this.cache });
    return cloneSnapshot(this.cache);
  }

  private async readFile(): Promise<SettingsSnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (error) {
        throw await this.corruptSettingsError(error);
      }
      const settingsFile = SettingsFileSchema.safeParse(parsed);
      if (!settingsFile.success) throw await this.corruptSettingsError(settingsFile.error);
      return cloneSnapshot(settingsFile.data.snapshot);
    } catch (error) {
      if (isNotFound(error)) return cloneSnapshot(DEFAULT_SETTINGS_SNAPSHOT);
      throw error;
    }
  }

  private async corruptSettingsError(cause: unknown): Promise<Error> {
    const backupFileName = await backupCorruptFile(this.filePath, 'settings.invalid');
    const message = backupFileName
      ? `Settings file is invalid. A backup was saved as ${backupFileName}.`
      : 'Settings file is invalid.';
    return new Error(message, { cause });
  }
}

function cloneSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
  return {
    ...snapshot,
    activityLog: cloneActivityLogSettings(snapshot.activityLog),
    density: snapshot.density ?? DEFAULT_DENSITY,
    firstRunGuide: cloneFirstRunGuideSettings(snapshot.firstRunGuide),
    firestoreWrites: normalizeFirestoreWriteSettings(snapshot.firestoreWrites),
    hotkeyOverrides: { ...snapshot.hotkeyOverrides },
    updates: cloneUpdateSettings(snapshot.updates),
    workspaceState: cloneWorkspaceState(snapshot.workspaceState),
    firestoreFieldCatalogs: Object.fromEntries(
      Object.entries(snapshot.firestoreFieldCatalogs).map(([key, entries]) => [
        key,
        entries.map((entry) => ({
          count: entry.count,
          field: entry.field,
          types: [...entry.types],
        })),
      ]),
    ),
    resultTableLayouts: Object.fromEntries(
      Object.entries(snapshot.resultTableLayouts).map(([key, value]) => [
        key,
        {
          columnOrder: [...value.columnOrder],
          columnSizing: { ...value.columnSizing },
        },
      ]),
    ),
  };
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

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

async function backupCorruptFile(filePath: string, prefix: string): Promise<string | null> {
  const backupName = `${prefix}-${new Date().toISOString().replaceAll(':', '-')}.json`;
  const backupPath = join(dirname(filePath), backupName);
  try {
    await rename(filePath, backupPath);
    return basename(backupPath);
  } catch {
    return null;
  }
}
