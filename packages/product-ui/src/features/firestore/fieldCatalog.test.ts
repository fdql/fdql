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
      { count: 2, field: 'status', types: ['string'] },
      { count: 1, field: 'active', types: ['boolean'] },
      { count: 1, field: 'deliveryLocation', types: ['geoPoint'] },
      { count: 1, field: 'lineItems', types: ['array<mixed>'] },
      { count: 1, field: 'ref', types: ['reference'] },
      { count: 1, field: 'updatedAt', types: ['timestamp'] },
      { count: 2, field: 'metadata.score', types: ['number'] },
      { count: 2, field: 'metadata.tags', types: ['array<mixed>', 'array<string>'] },
    ]);
  });

  it('handles encoded Firestore values and catalogs arrays as leaf fields', () => {
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
      { count: 1, field: 'encodedTime', types: ['timestamp'] },
      { count: 1, field: 'ignoredArray', types: ['array<mixed>'] },
      { count: 1, field: 'typedArray', types: ['array<number>'] },
      { count: 1, field: 'encodedMap.count', types: ['number'] },
    ]);
  });

  it('prioritizes shallow fields before deep fields under metadata budget pressure', () => {
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
      data: {
        createdAt: new FirestoreTimestamp('2026-04-24T09:30:12.058Z'),
        metadata,
        status: 'active',
      },
    }]);

    expect(catalog).toHaveLength(1_000);
    expect(catalog.slice(0, 2).map((entry) => entry.field)).toEqual(['createdAt', 'status']);
    expect(catalog).toContainEqual({ count: 1, field: 'metadata.field_0000', types: ['number'] });
    expect(catalog.at(-1)?.field).toBe('metadata.field_0997');
  });

  it('collapses repeated-shape maps into placeholder fields', () => {
    expect(
      fieldCatalogFromRows([{
        id: 'doc_1',
        path: 'payments/doc_1',
        hasSubcollections: false,
        data: {
          attemptsById: {
            first: {
              id: 'att_1',
              mode: 'card',
              providerPaymentIntentId: 'pi_1',
              status: 'paid',
              updatedAt: new FirestoreTimestamp('2026-04-24T09:30:12.058Z'),
            },
            second: {
              id: 'att_2',
              mode: 'card',
              providerPaymentIntentId: 'pi_2',
              status: 'failed',
              updatedAt: new FirestoreTimestamp('2026-04-25T09:30:12.058Z'),
            },
            third: {
              id: 'att_3',
              mode: 'pix',
              providerPaymentIntentId: 'pi_3',
              status: 'pending',
              updatedAt: new FirestoreTimestamp('2026-04-26T09:30:12.058Z'),
            },
          },
        },
      }]),
    ).toEqual([
      { count: 1, field: 'attemptsById.{id}.id', types: ['string'] },
      { count: 1, field: 'attemptsById.{id}.mode', types: ['string'] },
      { count: 1, field: 'attemptsById.{id}.providerPaymentIntentId', types: ['string'] },
      { count: 1, field: 'attemptsById.{id}.status', types: ['string'] },
      { count: 1, field: 'attemptsById.{id}.updatedAt', types: ['timestamp'] },
    ]);
  });

  it('collapses repeated-shape maps across loaded documents', () => {
    expect(
      fieldCatalogFromRows([
        {
          id: 'doc_1',
          path: 'payments/doc_1',
          hasSubcollections: false,
          data: {
            attemptsById: {
              attemptA: { amount: 10, status: 'paid' },
            },
          },
        },
        {
          id: 'doc_2',
          path: 'payments/doc_2',
          hasSubcollections: false,
          data: {
            attemptsById: {
              attemptB: { amount: 20, status: 'failed' },
            },
          },
        },
        {
          id: 'doc_3',
          path: 'payments/doc_3',
          hasSubcollections: false,
          data: {
            attemptsById: {
              attemptC: { amount: 30, status: 'pending' },
            },
          },
        },
      ]),
    ).toEqual([
      { count: 3, field: 'attemptsById.{id}.amount', types: ['number'] },
      { count: 3, field: 'attemptsById.{id}.status', types: ['string'] },
    ]);
  });

  it('derives dynamic map placeholders from by-key parent names', () => {
    expect(
      fieldCatalogFromRows([{
        id: 'doc_1',
        path: 'sessions/doc_1',
        hasSubcollections: false,
        data: {
          statsBySteamId: {
            S76561198000000000: { lapCount: 12, rating: 'gold' },
            S76561198154403932: { lapCount: 8, rating: 'silver' },
            S76561198276234129: { lapCount: 3, rating: 'bronze' },
          },
        },
      }]),
    ).toEqual([
      { count: 1, field: 'statsBySteamId.{steamId}.lapCount', types: ['number'] },
      { count: 1, field: 'statsBySteamId.{steamId}.rating', types: ['string'] },
    ]);
  });

  it('collapses nested repeated-shape maps recursively', () => {
    expect(
      fieldCatalogFromRows([{
        id: 'doc_1',
        path: 'payments/doc_1',
        hasSubcollections: false,
        data: {
          attemptsById: {
            first: {
              paymentsById: {
                p1: { amount: 10, status: 'paid' },
              },
              status: 'paid',
            },
            second: {
              paymentsById: {
                p2: { amount: 20, status: 'failed' },
              },
              status: 'failed',
            },
            third: {
              paymentsById: {
                p3: { amount: 30, status: 'pending' },
              },
              status: 'pending',
            },
          },
        },
      }]),
    ).toEqual([
      { count: 1, field: 'attemptsById.{id}.status', types: ['string'] },
      { count: 1, field: 'attemptsById.{id}.paymentsById.{id}.amount', types: ['number'] },
      { count: 1, field: 'attemptsById.{id}.paymentsById.{id}.status', types: ['string'] },
    ]);
  });

  it('counts collapsed dynamic fields once per document', () => {
    expect(
      fieldCatalogFromRows([
        {
          id: 'doc_1',
          path: 'payments/doc_1',
          hasSubcollections: false,
          data: {
            attemptsById: {
              first: { mode: 'card', status: 'paid' },
              second: { mode: 'pix', status: 'failed' },
              third: { mode: 'card', status: 'pending' },
            },
          },
        },
        {
          id: 'doc_2',
          path: 'payments/doc_2',
          hasSubcollections: false,
          data: {
            attemptsById: {
              fourth: { mode: 'card', status: 'paid' },
              fifth: { mode: 'pix', status: 'failed' },
              sixth: { mode: 'card', status: 'pending' },
            },
          },
        },
      ]),
    ).toEqual([
      { count: 2, field: 'attemptsById.{id}.mode', types: ['string'] },
      { count: 2, field: 'attemptsById.{id}.status', types: ['string'] },
    ]);
  });

  it('limits recursive dynamic map placeholders', () => {
    expect(
      fieldCatalogFromRows([{
        id: 'doc_1',
        path: 'items/doc_1',
        hasSubcollections: false,
        data: {
          levelsById: {
            first: {
              groupsById: {
                g1: {
                  paymentsById: { p1: { amount: 10, status: 'paid' } },
                  state: 'open',
                },
              },
              status: 'ready',
            },
            second: {
              groupsById: {
                g2: {
                  paymentsById: { p2: { amount: 20, status: 'failed' } },
                  state: 'closed',
                },
              },
              status: 'ready',
            },
            third: {
              groupsById: {
                g3: {
                  paymentsById: { p3: { amount: 30, status: 'pending' } },
                  state: 'open',
                },
              },
              status: 'ready',
            },
          },
        },
      }]),
    ).toEqual([
      { count: 1, field: 'levelsById.{id}.status', types: ['string'] },
      { count: 1, field: 'levelsById.{id}.groupsById.{id}.state', types: ['string'] },
    ]);
  });

  it('keeps normal domain maps concrete', () => {
    expect(
      fieldCatalogFromRows([{
        id: 'doc_1',
        path: 'users/doc_1',
        hasSubcollections: false,
        data: {
          roles: {
            admin: { enabled: true },
            owner: { enabled: true },
            user: { enabled: false },
          },
        },
      }]),
    ).toEqual([
      { count: 1, field: 'roles.admin.enabled', types: ['boolean'] },
      { count: 1, field: 'roles.owner.enabled', types: ['boolean'] },
      { count: 1, field: 'roles.user.enabled', types: ['boolean'] },
    ]);
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

  it('drops saved concrete dynamic paths when a placeholder path is observed', () => {
    expect(
      mergeFieldCatalogEntries(
        [
          { count: 1, field: 'attemptsById.attemptA.amount', types: ['number'] },
          { count: 1, field: 'attemptsById.attemptB.status', types: ['string'] },
          { count: 1, field: 'roles.admin.enabled', types: ['boolean'] },
        ],
        [
          { count: 3, field: 'attemptsById.{id}.amount', types: ['number'] },
          { count: 3, field: 'attemptsById.{id}.status', types: ['string'] },
        ],
      ),
    ).toEqual([
      { count: 3, field: 'attemptsById.{id}.amount', types: ['number'] },
      { count: 3, field: 'attemptsById.{id}.status', types: ['string'] },
      { count: 1, field: 'roles.admin.enabled', types: ['boolean'] },
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

  it('suggests from the draft target and records rows against the execution target', async () => {
    const loadedSnapshot: SettingsSnapshot = {
      ...settingsSnapshot,
      firestoreFieldCatalogs: {
        customers: [{ count: 2, field: 'plan', types: ['string'] }],
      },
    };
    const settings: SettingsRepository = {
      getHotkeyOverrides: vi.fn(async () => ({})),
      load: vi.fn(async () => loadedSnapshot),
      save: vi.fn(async (patch) => ({
        ...loadedSnapshot,
        firestoreFieldCatalogs: patch.firestoreFieldCatalogs
          ?? loadedSnapshot.firestoreFieldCatalogs,
      })),
      setHotkeyOverrides: vi.fn(async () => undefined),
    };

    const { result } = renderHook(() =>
      useFirestoreFieldCatalog({
        observationQueryPath: 'orders',
        queryPath: 'customers',
        rows: [{
          data: { total: 42 },
          hasSubcollections: false,
          id: 'ord_1',
          path: 'orders/ord_1',
        }],
        settings,
      })
    );

    await waitFor(() =>
      expect(result.current).toEqual([
        { count: 2, field: 'plan', types: ['string'] },
      ])
    );
    await waitFor(() =>
      expect(settings.save).toHaveBeenCalledWith({
        firestoreFieldCatalogs: {
          customers: [{ count: 2, field: 'plan', types: ['string'] }],
          orders: [{ count: 1, field: 'total', types: ['number'] }],
        },
      })
    );
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
