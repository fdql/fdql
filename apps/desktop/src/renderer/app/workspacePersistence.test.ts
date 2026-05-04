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
    })).resolves.toBeNull();

    const raw = JSON.stringify(settings.workspaceState);
    expect(raw).toContain('tab-firestore-1');
    expect(raw).toContain('tab-js-1');
    expect(raw).not.toContain('closed-tab');
    expect(raw).not.toContain('queryRequests');
    expect(raw).not.toContain('scriptResults');
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
    })).resolves.toBeNull();

    const raw = JSON.stringify(settings.workspaceState);
    expect(raw).toContain('tab-firestore-1');
    expect(raw).not.toContain('closed-tab');
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
    })).resolves.toBeNull();

    expect(settings.workspaceState).toBeNull();
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
): Pick<SettingsRepository, 'load' | 'save'> & { workspaceState: unknown | null; } {
  return {
    workspaceState: workspaceState ?? null,
    async load() {
      return settingsSnapshot(this.workspaceState);
    },
    async save(patch: Parameters<SettingsRepository['save']>[0]) {
      if ('workspaceState' in patch) this.workspaceState = patch.workspaceState ?? null;
      return settingsSnapshot(this.workspaceState);
    },
  };
}

function settingsSnapshot(workspaceState: unknown | null): SettingsSnapshot {
  return {
    activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
    dataMode: 'mock',
    density: 'compact',
    firestoreFieldCatalogs: {},
    firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
    hotkeyOverrides: {},
    inspectorWidth: 360,
    resultTableLayouts: {},
    sidebarWidth: 320,
    theme: 'system',
    updates: DEFAULT_UPDATE_SETTINGS,
    workspaceState,
  };
}
