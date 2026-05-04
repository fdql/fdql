import {
  FirestoreGeoPoint,
  FirestoreReference,
  FirestoreTimestamp,
} from '@firebase-desk/data-format';
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type SettingsRepository,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  fieldCatalogFromRows,
  fieldCatalogKeyForPath,
  mergeFieldCatalogEntries,
  useFirestoreFieldCatalog,
} from './fieldCatalog.ts';

describe('fieldCatalog', () => {
  it('uses collection chain keys without document ids', () => {
    expect(fieldCatalogKeyForPath('orders/ord_1/skiers/skier_1/results')).toBe(
      'orders/skiers/results',
    );
  });

  it('extracts primitive, native, nested, and primitive array fields', () => {
    expect(
      fieldCatalogFromRows([
        {
          id: 'ord_1',
          path: 'orders/ord_1',
          hasSubcollections: false,
          data: {
            active: true,
            deliveryLocation: new FirestoreGeoPoint(-36, 174),
            empty: [],
            lineItems: [{ sku: 'keyboard' }],
            metadata: {
              tags: ['priority', 'vip'],
              score: 0.2,
            },
            ref: new FirestoreReference('customers/cus_1'),
            status: 'paid',
            updatedAt: new FirestoreTimestamp('2026-04-24T09:30:12.058Z'),
          },
        },
        {
          id: 'ord_2',
          path: 'orders/ord_2',
          hasSubcollections: false,
          data: {
            metadata: {
              tags: ['mobile', null],
              score: 1,
            },
            status: 'pending',
          },
        },
      ]),
    ).toEqual([
      { count: 1, field: 'active', types: ['boolean'] },
      { count: 1, field: 'deliveryLocation', types: ['geoPoint'] },
      { count: 2, field: 'metadata.score', types: ['number'] },
      { count: 2, field: 'metadata.tags', types: ['array<mixed>', 'array<string>'] },
      { count: 1, field: 'ref', types: ['reference'] },
      { count: 2, field: 'status', types: ['string'] },
      { count: 1, field: 'updatedAt', types: ['timestamp'] },
    ]);
  });

  it('handles encoded Firestore values and ignores arrays of objects', () => {
    expect(
      fieldCatalogFromRows([{
        id: 'doc_1',
        path: 'items/doc_1',
        hasSubcollections: false,
        data: {
          encodedMap: { __type__: 'map', value: { count: 1 } },
          encodedTime: { __type__: 'timestamp', value: '2026-04-24T09:30:12.058Z' },
          ignoredArray: [{ name: 'Ada' }],
          typedArray: { __type__: 'array', value: [1, 2] },
        },
      }]),
    ).toEqual([
      { count: 1, field: 'encodedMap.count', types: ['number'] },
      { count: 1, field: 'encodedTime', types: ['timestamp'] },
      { count: 1, field: 'typedArray', types: ['array<number>'] },
    ]);
  });

  it('caps field catalog metadata scans for one huge nested document', () => {
    const metadata = Object.fromEntries(
      Array.from(
        { length: 5_000 },
        (_, index) => [`field_${String(index).padStart(4, '0')}`, index],
      ),
    );

    const catalog = fieldCatalogFromRows([{
      id: 'doc_1',
      path: 'items/doc_1',
      hasSubcollections: false,
      data: { metadata },
    }]);

    expect(catalog).toHaveLength(1_000);
    expect(catalog[0]?.field).toBe('metadata.field_0000');
    expect(catalog.at(-1)?.field).toBe('metadata.field_0999');
  });

  it('does not catalog fields deeper than the metadata depth budget', () => {
    expect(
      fieldCatalogFromRows([{
        id: 'doc_1',
        path: 'items/doc_1',
        hasSubcollections: false,
        data: { a: { b: { c: { d: { e: 1 } } } } },
      }]),
    ).toEqual([]);
  });

  it('merges counts and dedupes types', () => {
    expect(
      mergeFieldCatalogEntries(
        [{ count: 2, field: 'status', types: ['string'] }],
        [
          { count: 1, field: 'status', types: ['string'] },
          { count: 1, field: 'total', types: ['number'] },
        ],
      ),
    ).toEqual([
      { count: 3, field: 'status', types: ['string'] },
      { count: 1, field: 'total', types: ['number'] },
    ]);
  });

  it('reports settings load failures', async () => {
    const onSettingsError = vi.fn();
    const settings: SettingsRepository = {
      getHotkeyOverrides: vi.fn(async () => ({})),
      load: vi.fn(async () => {
        throw new Error('catalog load failed');
      }),
      save: vi.fn(async () => settingsSnapshot),
      setHotkeyOverrides: vi.fn(async () => undefined),
    };

    renderHook(() =>
      useFirestoreFieldCatalog({
        onSettingsError,
        queryPath: 'orders',
        rows: [],
        settings,
      })
    );

    await waitFor(() => expect(onSettingsError).toHaveBeenCalledWith('catalog load failed'));
  });

  it('reports settings save failures', async () => {
    const onSettingsError = vi.fn();
    const settings: SettingsRepository = {
      getHotkeyOverrides: vi.fn(async () => ({})),
      load: vi.fn(async () => settingsSnapshot),
      save: vi.fn(async () => {
        throw new Error('catalog save failed');
      }),
      setHotkeyOverrides: vi.fn(async () => undefined),
    };

    renderHook(() =>
      useFirestoreFieldCatalog({
        onSettingsError,
        queryPath: 'orders',
        rows: [{
          data: { status: 'paid' },
          hasSubcollections: false,
          id: 'ord_1',
          path: 'orders/ord_1',
        }],
        settings,
      })
    );

    await waitFor(() => expect(onSettingsError).toHaveBeenCalledWith('catalog save failed'));
  });
});

const settingsSnapshot: SettingsSnapshot = {
  activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
  dataMode: 'mock',
  density: 'compact',
  firstRunGuide: { completedAt: null },
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
