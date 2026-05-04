import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { describe, expect, it } from 'vitest';
import { MainSettingsRepository } from './main-settings-repository.ts';

const initialSnapshot: SettingsSnapshot = {
  activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
  sidebarWidth: 320,
  inspectorWidth: 360,
  theme: 'system',
  density: 'compact',
  dataMode: 'mock',
  hotkeyOverrides: { 'query.run': 'Meta+Enter' },
  resultTableLayouts: {},
  firestoreFieldCatalogs: {},
  firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
  updates: DEFAULT_UPDATE_SETTINGS,
  workspaceState: null,
};

describe('MainSettingsRepository', () => {
  it('merges patches without erasing omitted settings', async () => {
    const store = new MemorySettingsStore(initialSnapshot);
    const repository = new MainSettingsRepository(store);

    await expect(repository.save({ dataMode: 'live' })).resolves.toEqual({
      ...initialSnapshot,
      dataMode: 'live',
    });
  });

  it('updates hotkey overrides through the settings snapshot', async () => {
    const store = new MemorySettingsStore(initialSnapshot);
    const repository = new MainSettingsRepository(store);

    await repository.setHotkeyOverrides({ 'tab.new': 'Meta+N' });

    await expect(repository.getHotkeyOverrides()).resolves.toEqual({ 'tab.new': 'Meta+N' });
  });

  it('preserves table layouts through partial saves', async () => {
    const store = new MemorySettingsStore({
      ...initialSnapshot,
      resultTableLayouts: {
        orders: { columnOrder: ['id', 'total'], columnSizing: { total: 220 } },
      },
    });
    const repository = new MainSettingsRepository(store);

    await expect(repository.save({ sidebarWidth: 400 })).resolves.toMatchObject({
      sidebarWidth: 400,
      resultTableLayouts: {
        orders: { columnOrder: ['id', 'total'], columnSizing: { total: 220 } },
      },
    });
  });

  it('does not expose mutable nested table layout state', async () => {
    const store = new MemorySettingsStore({
      ...initialSnapshot,
      resultTableLayouts: {
        orders: { columnOrder: ['id', 'total'], columnSizing: { total: 220 } },
      },
    });

    const loaded = await store.load();
    loaded.resultTableLayouts.orders?.columnOrder.push('status');
    loaded.resultTableLayouts.orders!.columnSizing.total = 80;

    await expect(store.load()).resolves.toMatchObject({
      resultTableLayouts: {
        orders: { columnOrder: ['id', 'total'], columnSizing: { total: 220 } },
      },
    });
  });

  it('preserves field catalogs through partial saves', async () => {
    const store = new MemorySettingsStore({
      ...initialSnapshot,
      firestoreFieldCatalogs: {
        orders: [{ count: 2, field: 'customer.name', types: ['string'] }],
      },
    });
    const repository = new MainSettingsRepository(store);

    await expect(repository.save({ inspectorWidth: 420 })).resolves.toMatchObject({
      inspectorWidth: 420,
      firestoreFieldCatalogs: {
        orders: [{ count: 2, field: 'customer.name', types: ['string'] }],
      },
    });
  });
});

class MemorySettingsStore {
  constructor(private snapshot: SettingsSnapshot) {}

  async load(): Promise<SettingsSnapshot> {
    return this.clone(this.snapshot);
  }

  async save(snapshot: SettingsSnapshot): Promise<SettingsSnapshot> {
    this.snapshot = this.clone(snapshot);
    return this.clone(this.snapshot);
  }

  private clone(snapshot: SettingsSnapshot): SettingsSnapshot {
    return {
      ...snapshot,
      hotkeyOverrides: { ...snapshot.hotkeyOverrides },
      resultTableLayouts: Object.fromEntries(
        Object.entries(snapshot.resultTableLayouts).map(([key, layout]) => [
          key,
          {
            columnOrder: [...layout.columnOrder],
            columnSizing: { ...layout.columnSizing },
          },
        ]),
      ),
      firestoreFieldCatalogs: Object.fromEntries(
        Object.entries(snapshot.firestoreFieldCatalogs).map(([key, entries]) => [
          key,
          entries.map((entry) => ({
            ...entry,
            types: [...entry.types],
          })),
        ]),
      ),
      updates: { ...snapshot.updates },
    };
  }
}
