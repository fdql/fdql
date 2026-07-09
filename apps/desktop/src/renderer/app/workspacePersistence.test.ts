import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type SettingsRepository,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPersistedWorkspaceState,
  loadPersistedWorkspaceStateResult,
  type PersistedWorkspaceState,
  savePersistedWorkspaceState,
} from './workspacePersistence.ts';

const persistedWorkspace: PersistedWorkspaceState = {
  version: 1,
  authFilter: 'ada',
  scripts: { 'tab-js-1': 'return 1;' },
  tabsState: {
    activeTabId: 'tab-firestore-1',
    interactionHistory: [{
      activeTabId: 'tab-firestore-1',
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    }],
    interactionHistoryIndex: 0,
    tabs: [
      {
        id: 'tab-firestore-1',
        kind: 'firestore-query',
        title: 'orders',
        connectionId: 'emu',
        history: ['orders'],
        historyIndex: 0,
        inspectorWidth: 360,
      },
      {
        id: 'tab-js-1',
        kind: 'js-query',
        title: 'JS Query',
        connectionId: 'emu',
        history: ['scripts/default'],
        historyIndex: 0,
        inspectorWidth: 360,
      },
    ],
  },
  drafts: {
    'tab-firestore-1': {
      path: 'orders',
      filters: [{ id: 'filter-1', field: 'status', op: '==', value: '"paid"' }],
      filterField: 'status',
      filterOp: '==',
      filterValue: '"paid"',
      sortField: 'updatedAt',
      sortDirection: 'desc',
      limit: 25,
    },
  },
};

describe('workspacePersistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads valid user workspace state', async () => {
    const settings = settingsWithWorkspace(persistedWorkspace);

    await expect(loadPersistedWorkspaceState(settings)).resolves.toEqual(persistedWorkspace);
  });

  it('does not restore workspace state older than an explicit clear marker', async () => {
    const settings = settingsWithWorkspace({ ...persistedWorkspace, savedAt: 100 });
    settings.workspaceStateClearedAt = 200;

    await expect(loadPersistedWorkspaceState(settings)).resolves.toBeNull();
    await expect(loadPersistedWorkspaceStateResult(settings)).resolves.toEqual({
      error: null,
      snapshot: null,
    });
  });

  it('loads Firestore inspector UI state for open tabs', async () => {
    const workspace = {
      ...persistedWorkspace,
      firestoreInspectorUi: {
        'tab-firestore-1': {
          overviewCollapsed: true,
          resultTreeExpandedIds: ['root:orders'],
          sections: {
            fieldsInResults: true,
            jsonContext: true,
            selectionPreview: false,
          },
          selectionPreviewExpandedPathsByDocumentPath: {
            'orders/ord_1': ['["customer"]'],
          },
        },
      },
    } satisfies PersistedWorkspaceState;
    const settings = settingsWithWorkspace(workspace);

    await expect(loadPersistedWorkspaceState(settings)).resolves.toEqual(workspace);
  });

  it('does not restore invalid workspace state', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: { ...persistedWorkspace.tabsState, activeTabId: 'missing-tab' },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toBeNull();
    await expect(loadPersistedWorkspaceStateResult(settings)).resolves.toMatchObject({
      error: {
        operation: 'load',
      },
    });
  });

  it('does not restore invalid tab history state', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        tabs: [
          { ...persistedWorkspace.tabsState.tabs[0]!, historyIndex: 1 },
          persistedWorkspace.tabsState.tabs[1]!,
        ],
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toBeNull();
  });

  it('restores workspace state with stale closed-tab interaction history', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        interactionHistory: [
          ...persistedWorkspace.tabsState.interactionHistory,
          {
            activeTabId: 'closed-tab',
            path: 'closed',
            selectedTreeItemId: 'collection:emu:closed',
          },
        ],
        interactionHistoryIndex: 1,
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toEqual({
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        interactionHistoryIndex: 0,
      },
    });
  });

  it('restores workspace state with duplicate tab ids by renaming duplicates', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        tabs: [
          persistedWorkspace.tabsState.tabs[0]!,
          {
            ...persistedWorkspace.tabsState.tabs[0]!,
            history: ['admin-leagues'],
            title: 'admin-leagues',
          },
          persistedWorkspace.tabsState.tabs[1]!,
        ],
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      tabsState: {
        activeTabId: 'tab-firestore-1',
        tabs: [
          { id: 'tab-firestore-1', title: 'orders' },
          { id: 'tab-firestore-1-2', title: 'admin-leagues' },
          { id: 'tab-js-1', title: 'JS Query' },
        ],
      },
    });
  });

  it('does not restore invalid draft state', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      drafts: {
        'tab-firestore-1': {
          ...persistedWorkspace.drafts['tab-firestore-1']!,
          filterOp: 'contains',
        },
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toBeNull();
  });

  it('saves only user tab state and drops orphan tab records', async () => {
    const settings = settingsWithWorkspace(null);

    await expect(savePersistedWorkspaceState(settings, {
      ...persistedWorkspace,
      drafts: {
        ...persistedWorkspace.drafts,
        'closed-tab': {
          ...persistedWorkspace.drafts['tab-firestore-1']!,
          path: 'customers',
        },
      },
      scripts: { ...persistedWorkspace.scripts, 'closed-tab': 'return 2;' },
      firestoreInspectorUi: {
        'tab-firestore-1': {
          overviewCollapsed: true,
          resultTreeExpandedIds: ['root:orders'],
          sections: {
            fieldsInResults: true,
            jsonContext: true,
            selectionPreview: false,
          },
          selectionPreviewExpandedPathsByDocumentPath: {
            'orders/ord_1': ['["customer"]'],
          },
        },
        'closed-tab': {
          overviewCollapsed: false,
          resultTreeExpandedIds: null,
          sections: {
            fieldsInResults: false,
            jsonContext: true,
            selectionPreview: true,
          },
          selectionPreviewExpandedPathsByDocumentPath: {},
        },
      },
    })).resolves.toBeNull();

    const raw = JSON.stringify(settings.workspaceState);
    expect(raw).toContain('tab-firestore-1');
    expect(raw).toContain('tab-js-1');
    expect(raw).not.toContain('closed-tab');
    expect(raw).not.toContain('queryRequests');
    expect(raw).not.toContain('scriptResults');
    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      firestoreInspectorUi: {
        'tab-firestore-1': {
          overviewCollapsed: true,
          resultTreeExpandedIds: ['root:orders'],
        },
      },
    });
  });

  it('saves only open-tab interaction history', async () => {
    const settings = settingsWithWorkspace(null);

    await expect(savePersistedWorkspaceState(settings, {
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        interactionHistory: [
          ...persistedWorkspace.tabsState.interactionHistory,
          {
            activeTabId: 'closed-tab',
            path: 'closed',
            selectedTreeItemId: 'collection:emu:closed',
          },
        ],
        interactionHistoryIndex: 1,
      },
    }, { recordedAtMs: 300 })).resolves.toBeNull();

    const raw = JSON.stringify(settings.workspaceState);
    expect(raw).toContain('tab-firestore-1');
    expect(raw).not.toContain('closed-tab');
    expect(settings.workspaceState).toMatchObject({ savedAt: 300 });
    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      tabsState: { interactionHistoryIndex: 0 },
    });
  });

  it('removes storage when no tabs are open', async () => {
    const settings = settingsWithWorkspace(persistedWorkspace);

    await expect(savePersistedWorkspaceState(settings, {
      authFilter: '',
      drafts: {},
      scripts: {},
      tabsState: {
        activeTabId: '',
        interactionHistory: [],
        interactionHistoryIndex: 0,
        tabs: [],
      },
    }, { recordedAtMs: 400 })).resolves.toBeNull();

    expect(settings.workspaceState).toBeNull();
    expect(settings.workspaceStateClearedAt).toBe(400);
  });

  it('returns save failures instead of swallowing them', async () => {
    const settings = settingsWithWorkspace(null);
    settings.save = vi.fn(async () => {
      throw new Error('settings unavailable');
    }) as typeof settings.save;

    await expect(savePersistedWorkspaceState(settings, persistedWorkspace)).resolves.toEqual({
      message: 'settings unavailable',
      operation: 'save',
    });
  });
});

function settingsWithWorkspace(
  workspaceState: unknown,
): Pick<SettingsRepository, 'load' | 'save'> & {
  workspaceState: unknown | null;
  workspaceStateClearedAt: number | null;
} {
  return {
    workspaceState: workspaceState ?? null,
    workspaceStateClearedAt: null,
    async load() {
      return settingsSnapshot(this.workspaceState, this.workspaceStateClearedAt);
    },
    async save(patch: Parameters<SettingsRepository['save']>[0]) {
      if ('workspaceState' in patch) this.workspaceState = patch.workspaceState ?? null;
      if ('workspaceStateClearedAt' in patch) {
        this.workspaceStateClearedAt = patch.workspaceStateClearedAt ?? null;
      }
      return settingsSnapshot(this.workspaceState, this.workspaceStateClearedAt);
    },
  };
}

function settingsSnapshot(
  workspaceState: unknown | null,
  workspaceStateClearedAt: number | null = null,
): SettingsSnapshot {
  return {
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
    workspaceState,
    workspaceStateClearedAt,
  };
}
