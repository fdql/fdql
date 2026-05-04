import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS_SNAPSHOT, SettingsStore } from './settings-store.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('SettingsStore', () => {
  it('keeps overlapping saves from sharing temp files', async () => {
    const userDataPath = await makeTempDir();
    const store = new SettingsStore(userDataPath);
    const snapshots = Array.from({ length: 20 }, (_, index) => ({
      ...DEFAULT_SETTINGS_SNAPSHOT,
      sidebarWidth: 300 + index,
    }));

    await expect(Promise.all(snapshots.map((snapshot) => store.save(snapshot)))).resolves
      .toHaveLength(snapshots.length);

    await expect(readdir(userDataPath)).resolves.toEqual(['settings.json']);
    const persisted = JSON.parse(await readFile(join(userDataPath, 'settings.json'), 'utf8')) as {
      readonly snapshot?: { readonly sidebarWidth?: unknown; };
      readonly version?: unknown;
    };
    expect(persisted.version).toBe(1);
    expect(typeof persisted.snapshot?.sidebarWidth).toBe('number');
  });

  it('backs up invalid settings file values and recovers on the next load', async () => {
    const userDataPath = await makeTempDir();
    const invalidSettings = JSON.stringify({
      version: 1,
      snapshot: {
        sidebarWidth: 'wide',
        inspectorWidth: 444,
        theme: 123,
        dataMode: 'other',
        hotkeyOverrides: { bad: 42 },
      },
    });
    await writeFile(
      join(userDataPath, 'settings.json'),
      invalidSettings,
    );
    const store = new SettingsStore(userDataPath);

    await expect(store.load()).rejects.toThrow(
      /Settings file is invalid\. A backup was saved as settings\.invalid-.+\.json\./,
    );

    const files = await readdir(userDataPath);
    const backupFile = files.find((file) => file.startsWith('settings.invalid-'));
    expect(backupFile).toBeDefined();
    await expect(readFile(join(userDataPath, backupFile!), 'utf8')).resolves.toBe(
      invalidSettings,
    );
    await expect(store.load()).resolves.toEqual(DEFAULT_SETTINGS_SNAPSHOT);
  });

  it('defaults table layouts for existing settings files', async () => {
    const userDataPath = await makeTempDir();
    await writeFile(
      join(userDataPath, 'settings.json'),
      JSON.stringify({
        version: 1,
        snapshot: {
          sidebarWidth: 320,
          inspectorWidth: 360,
          theme: 'system',
          dataMode: 'mock',
          hotkeyOverrides: {},
        },
      }),
    );

    await expect(new SettingsStore(userDataPath).load()).resolves.toEqual({
      ...DEFAULT_SETTINGS_SNAPSHOT,
      dataMode: 'mock',
      resultTableLayouts: {},
      firestoreFieldCatalogs: {},
      firstRunGuide: { completedAt: null },
      updates: DEFAULT_SETTINGS_SNAPSHOT.updates,
    });
  });

  it('defaults first launch to mock mode', async () => {
    const userDataPath = await makeTempDir();

    await expect(new SettingsStore(userDataPath).load()).resolves.toMatchObject({
      dataMode: 'mock',
      firstRunGuide: { completedAt: null },
    });
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'firebase-desk-settings-'));
  tempDirs.push(dir);
  return dir;
}
