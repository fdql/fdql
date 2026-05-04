import {
  type ActivityLogSettings,
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  type HotkeyOverrides,
  type SettingsPatch,
  type SettingsRepository,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityLogStore } from '../storage/activity-log-store.ts';
import { DEFAULT_SETTINGS_SNAPSHOT } from '../storage/settings-store.ts';
import { MainActivityLogRepository } from './main-activity-log-repository.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('MainActivityLogRepository', () => {
  it('stores metadata only by default and strips credential fields', async () => {
    const repository = await makeRepository({
      detailMode: 'metadata',
      enabled: true,
      maxBytes: 1024 * 1024,
    });

    const entry = await repository.append({
      action: 'Add account',
      area: 'projects',
      metadata: { serviceAccountJson: '{}', name: 'Local' },
      payload: { data: { ok: true } },
      status: 'success',
      summary: 'Added Local',
    });

    expect(entry.payload).toBeUndefined();
    expect(entry.metadata).toEqual({ name: 'Local' });
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it('stores allowed full payloads and strips credential fields', async () => {
    const repository = await makeRepository({
      detailMode: 'fullPayload',
      enabled: true,
      maxBytes: 1024 * 1024,
    });

    const entry = await repository.append({
      action: 'Save document',
      area: 'firestore',
      payload: { data: { privateKey: 'secret', title: 'Saved' } },
      status: 'success',
      summary: 'Saved orders/ord_1',
    });

    expect(entry.payload).toEqual({ data: { title: 'Saved' } });
  });

  it('marks oversized payloads as truncated', async () => {
    const repository = await makeRepository({
      detailMode: 'fullPayload',
      enabled: true,
      maxBytes: 400,
    });

    const entry = await repository.append({
      action: 'Save document',
      area: 'firestore',
      metadata: { path: 'orders/ord_1' },
      payload: { data: { body: 'x'.repeat(1000) } },
      status: 'success',
      summary: 'Saved orders/ord_1',
    });

    expect(entry.payload).toBeUndefined();
    expect(entry.metadata).toMatchObject({ path: 'orders/ord_1', payloadTruncated: true });
  });

  it('exports filtered JSONL through the save dialog path', async () => {
    const dir = await makeTempDir();
    const settings = new MemorySettingsRepository(DEFAULT_ACTIVITY_LOG_SETTINGS);
    const exportPath = join(dir, 'activity-export.jsonl');
    const repository = new MainActivityLogRepository(new ActivityLogStore(dir), settings, {
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: exportPath })),
    });
    await repository.append({
      action: 'Save document',
      area: 'firestore',
      status: 'success',
      summary: 'Saved',
    });
    await repository.append({
      action: 'Search users',
      area: 'auth',
      status: 'failure',
      summary: 'Failed',
    });

    await expect(repository.export({ area: 'auth' })).resolves.toEqual({
      canceled: false,
      filePath: exportPath,
    });

    const exported = await readFile(exportPath, 'utf8');
    expect(exported).toContain('"area":"auth"');
    expect(exported).not.toContain('"area":"firestore"');
  });
});

async function makeRepository(settings: ActivityLogSettings): Promise<MainActivityLogRepository> {
  return new MainActivityLogRepository(
    new ActivityLogStore(await makeTempDir()),
    new MemorySettingsRepository(settings),
    { showSaveDialog: vi.fn(async () => ({ canceled: true })) },
  );
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'firebase-desk-activity-repo-'));
  tempDirs.push(dir);
  return dir;
}

class MemorySettingsRepository implements SettingsRepository {
  private snapshot: SettingsSnapshot;

  constructor(activityLog: ActivityLogSettings) {
    this.snapshot = { ...DEFAULT_SETTINGS_SNAPSHOT, activityLog };
  }

  async load(): Promise<SettingsSnapshot> {
    return this.snapshot;
  }

  async save(patch: SettingsPatch): Promise<SettingsSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      ...(patch.activityLog ? { activityLog: patch.activityLog } : {}),
      ...(patch.dataMode ? { dataMode: patch.dataMode } : {}),
      ...(patch.density ? { density: patch.density } : {}),
      ...(patch.firestoreFieldCatalogs
        ? { firestoreFieldCatalogs: patch.firestoreFieldCatalogs }
        : {}),
      ...(patch.firestoreWrites ? { firestoreWrites: patch.firestoreWrites } : {}),
      ...(patch.hotkeyOverrides ? { hotkeyOverrides: patch.hotkeyOverrides } : {}),
      ...(patch.inspectorWidth === undefined ? {} : { inspectorWidth: patch.inspectorWidth }),
      ...(patch.resultTableLayouts ? { resultTableLayouts: patch.resultTableLayouts } : {}),
      ...(patch.sidebarWidth === undefined ? {} : { sidebarWidth: patch.sidebarWidth }),
      ...(patch.theme ? { theme: patch.theme } : {}),
      ...(patch.updates ? { updates: patch.updates } : {}),
      ...(patch.workspaceState === undefined ? {} : { workspaceState: patch.workspaceState }),
    };
    return this.snapshot;
  }

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return this.snapshot.hotkeyOverrides;
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    this.snapshot = { ...this.snapshot, hotkeyOverrides: overrides };
  }
}
