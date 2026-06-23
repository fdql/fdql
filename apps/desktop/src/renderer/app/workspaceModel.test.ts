import { describe, expect, it } from 'vitest';
import {
  authNodeId,
  buildTreeItems,
  clampSidebarWidth,
  collectionNodeId,
  DEFAULT_FIRESTORE_DRAFT,
  draftToQuery,
  getDraft,
  isDocumentPath,
  normalizePath,
  omitKey,
  parseTreeId,
  projectIdForConnection,
  projectNodeId,
  projectTargetForOption,
  queryFiltersForDraft,
  treeItemIdForTab,
} from './workspaceModel.ts';

describe('workspaceModel', () => {
  it('does not sort new collection queries by a field unless requested', () => {
    expect(DEFAULT_FIRESTORE_DRAFT.sortField).toBe('');
    expect(draftToQuery('demo-local', DEFAULT_FIRESTORE_DRAFT).sorts).toEqual([]);
  });

  it('builds firestore query from root collection draft controls', () => {
    expect(draftToQuery('demo-local', {
      ...DEFAULT_FIRESTORE_DRAFT,
      path: '/orders/',
      filters: [{ id: 'filter-1', field: ' status ', op: '==', value: '"paid"' }],
      sortField: ' updatedAt ',
      sortDirection: 'desc',
    })).toEqual({
      connectionId: 'demo-local',
      path: 'orders',
      filters: [{ field: 'status', op: '==', value: 'paid' }],
      sorts: [{ field: 'updatedAt', direction: 'desc' }],
    });
  });

  it('ignores collection query controls for document paths', () => {
    expect(draftToQuery('demo-local', {
      ...DEFAULT_FIRESTORE_DRAFT,
      path: 'orders/ord_1024',
      filters: [{ id: 'filter-1', field: 'status', op: '==', value: '"paid"' }],
      sortField: 'updatedAt',
    })).toEqual({
      connectionId: 'demo-local',
      path: 'orders/ord_1024',
      filters: [],
      sorts: [],
    });
  });

  it('parses draft filter values as json when possible', () => {
    expect(queryFiltersForDraft({
      ...DEFAULT_FIRESTORE_DRAFT,
      filters: [
        { id: 'filter-1', field: 'count', op: '>=', value: '2' },
        { id: 'filter-2', field: 'name', op: '==', value: 'Ada' },
        { id: 'filter-3', field: 'archivedAt', op: '==', value: 'null' },
        { id: 'filter-4', field: '', op: '==', value: 'ignored' },
      ],
    })).toEqual([
      { field: 'count', op: '>=', value: 2 },
      { field: 'name', op: '==', value: 'Ada' },
      { field: 'archivedAt', op: '==', value: null },
    ]);
  });

  it('normalizes paths and classifies document paths', () => {
    expect(normalizePath('/orders//ord_1024/')).toBe('orders/ord_1024');
    expect(isDocumentPath('orders/ord_1024')).toBe(true);
    expect(isDocumentPath('orders')).toBe(false);
  });

  it('creates tree ids and restores tab tree ids', () => {
    const tab = {
      id: 'tab-firestore-query-1',
      kind: 'firestore-query' as const,
      title: 'orders',
      connectionId: 'emu',
      history: ['orders'],
      historyIndex: 0,
      inspectorWidth: 360,
    };

    expect(treeItemIdForTab(tab)).toBe(collectionNodeId('emu', 'orders'));
    expect(parseTreeId('collection:emu:orders/ord_1024/events')).toEqual({
      kind: 'collection',
      connectionId: 'emu',
      path: 'orders/ord_1024/events',
    });
    expect(authNodeId('emu')).toBe('auth:emu');
  });

  it('builds filtered account tree items', () => {
    const items = buildTreeItems(
      [{
        id: 'emu',
        name: 'Local Emulator',
        projectId: 'demo-local',
        target: 'emulator',
        emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
        hasCredential: false,
        credentialEncrypted: null,
        createdAt: '2026-04-27T00:00:00.000Z',
      }],
      new Set([projectNodeId('emu'), 'firestore:emu']),
      {
        tools: { emu: { status: 'success', items: ['tools'] } },
        roots: { emu: { status: 'success', items: [{ id: 'orders', path: 'orders' }] } },
      },
      'collection:emu:orders',
      'orders',
    );

    expect(items).toEqual([
      expect.objectContaining({
        id: 'collection:emu:orders',
        label: 'orders',
        selected: true,
      }),
    ]);
  });

  it('formats sidebar project and collection metadata', () => {
    const items = buildTreeItems(
      [
        {
          id: 'prod',
          name: 'acme-prod',
          projectId: 'acme-prod',
          target: 'production',
          hasCredential: true,
          credentialEncrypted: true,
          createdAt: '2026-04-27T00:00:00.000Z',
        },
        {
          id: 'emu',
          name: 'Local Emulator',
          projectId: 'demo-local',
          target: 'emulator',
          emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
          hasCredential: false,
          credentialEncrypted: null,
          createdAt: '2026-04-27T00:00:00.000Z',
        },
      ],
      new Set([projectNodeId('emu'), 'firestore:emu']),
      {
        tools: { emu: { status: 'success', items: ['tools'] } },
        roots: {
          emu: {
            status: 'success',
            items: [{ id: 'orders', path: 'orders', documentCount: 99 }],
          },
        },
      },
      null,
      '',
    );

    const prod = items.find((item) => item.id === 'project:prod');
    const emu = items.find((item) => item.id === 'project:emu');
    const firestore = items.find((item) => item.id === 'firestore:emu');
    const collection = items.find((item) => item.id === 'collection:emu:orders');

    expect(prod?.label).toBe('acme-prod');
    expect('projectTarget' in (prod ?? {})).toBe(false);
    expect('secondary' in (prod ?? {})).toBe(false);
    expect(emu?.label).toBe('Local Emulator (demo-local)');
    expect(emu?.projectTarget).toBe('emulator');
    expect('secondary' in (emu ?? {})).toBe(false);
    expect(firestore?.canCreateCollection).toBe(true);
    expect(collection?.label).toBe('orders');
    expect('secondary' in (collection ?? {})).toBe(false);
  });

  it('only allows sidebar new collection after root collections load', () => {
    const items = buildTreeItems(
      [{
        id: 'emu',
        name: 'Local Emulator',
        projectId: 'demo-local',
        target: 'emulator',
        emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
        hasCredential: false,
        credentialEncrypted: null,
        createdAt: '2026-04-27T00:00:00.000Z',
      }],
      new Set([projectNodeId('emu')]),
      { tools: { emu: { status: 'success', items: ['tools'] } }, roots: {} },
      null,
      '',
    );

    expect(items.find((item) => item.id === 'firestore:emu')?.canCreateCollection).toBe(false);
  });

  it('shows an empty root collections state with the Firebase project id', () => {
    const items = buildTreeItems(
      [{
        id: 'emu',
        name: 'Local Emulator',
        projectId: 'demo-firebase-lite',
        target: 'emulator',
        emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
        hasCredential: false,
        credentialEncrypted: null,
        createdAt: '2026-04-27T00:00:00.000Z',
      }],
      new Set([projectNodeId('emu'), 'firestore:emu']),
      {
        tools: { emu: { status: 'success', items: ['tools'] } },
        roots: { emu: { status: 'success', items: [] } },
      },
      null,
      '',
    );

    expect(items).toContainEqual(expect.objectContaining({
      id: 'status:firestore:emu',
      label: 'No root collections',
      secondary: 'demo-firebase-lite',
      canRefresh: true,
    }));
  });

  it('returns default drafts and immutable omitted records', () => {
    expect(getDraft(undefined, {})).toBe(DEFAULT_FIRESTORE_DRAFT);
    expect(omitKey({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 });
  });

  it('formats account metadata and clamps sidebar width', () => {
    expect(projectIdForConnection(' Client Dev ')).toBe('client-dev');
    expect(projectTargetForOption('production-service-account')).toBe('production');
    expect(projectTargetForOption('local-emulator')).toBe('emulator');
    expect(clampSidebarWidth(999)).toBe(999);
    expect(clampSidebarWidth(Number.NaN)).toBe(320);
  });
});
