import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type SettingsPatch,
  type SettingsRepository,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersistedWorkspaceState,
  loadPersistedWorkspaceState,
  loadPersistedWorkspaceStateResult,
  type PersistedWorkspaceState,
  savePersistedWorkspaceState,
} from './workspacePersistence.ts';

const firestoreDraft = {
  path: 'orders',
  filters: [{ id: 'filter-1', field: 'status', op: '==' as const, value: '"paid"' }],
  filterField: 'status',
  filterOp: '==' as const,
  filterValue: '"paid"',
  sortField: 'updatedAt',
  sortDirection: 'desc' as const,
  limit: 25,
};

const inspectorUi = {
  overviewCollapsed: false,
  resultView: 'tree' as const,
  resultTreeExpandedIds: null,
  sections: {
    fieldsInResults: false,
    jsonContext: true,
    selectionPreview: true,
  },
  selectionPreviewExpandedPathsByDocumentPath: {},
};

const persistedWorkspace: PersistedWorkspaceState = {
  version: 2,
  authFilter: 'ada',
  scripts: { 'tab-js-1': 'return 1;' },
  tabsState: {
    activeTabId: 'tab-firestore-1',
    interactionHistory: [{
      activeTabId: 'tab-firestore-1',
      location: {
        kind: 'firestore-query',
        connectionId: 'emu',
        draft: firestoreDraft,
      },
      selectedTreeItemId: 'collection:emu:orders',
    }],
    interactionHistoryIndex: 0,
    selectedTreeItemId: 'collection:emu:orders',
    tabs: [
      {
        id: 'tab-firestore-1',
        kind: 'firestore-query',
        connectionId: 'emu',
        draft: firestoreDraft,
        inspectorUi,
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
};

const persistedWorkspaceV1 = {
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
    'tab-firestore-1': { ...firestoreDraft, path: 'customers' },
  },
  firestoreInspectorUi: {
    'tab-firestore-1': {
      overviewCollapsed: true,
      resultTreeExpandedIds: null,
      sections: inspectorUi.sections,
      selectionPreviewExpandedPathsByDocumentPath: {},
    },
  },
};

describe('workspacePersistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads valid version 2 workspace state', async () => {
    const settings = settingsWithWorkspace(persistedWorkspace);

    await expect(loadPersistedWorkspaceState(settings)).resolves.toEqual(persistedWorkspace);
  });

  it('migrates version 1 drafts and inspector state into Firestore tabs', async () => {
    const settings = settingsWithWorkspace(persistedWorkspaceV1);

    const restored = await loadPersistedWorkspaceState(settings);

    expect(restored?.tabsState.tabs[0]).toMatchObject({
      id: 'tab-firestore-1',
      kind: 'firestore-query',
      draft: { path: 'customers' },
      inspectorUi: { overviewCollapsed: true, resultView: 'table' },
    });
    expect(restored?.tabsState.interactionHistory[0]).toMatchObject({
      location: {
        kind: 'firestore-query',
        draft: {
          path: 'customers',
          filterField: 'status',
          limit: 25,
          sortField: 'updatedAt',
        },
      },
    });
  });

  it('migrates unknowable legacy history controls to defaults', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspaceV1,
      tabsState: {
        ...persistedWorkspaceV1.tabsState,
        interactionHistory: [
          {
            activeTabId: 'tab-firestore-1',
            path: 'orders',
            selectedTreeItemId: 'collection:emu:orders',
          },
          {
            activeTabId: 'tab-firestore-1',
            path: 'legacy-audit',
            selectedTreeItemId: 'collection:emu:legacy-audit',
          },
        ],
        interactionHistoryIndex: 1,
      },
    });

    const restored = await loadPersistedWorkspaceState(settings);
    const history = restored?.tabsState.interactionHistory;

    expect(history?.[0]).toMatchObject({
      location: {
        draft: { filters: [], limit: 25, path: 'orders', sortField: '' },
      },
    });
    expect(history?.[1]).toMatchObject({
      location: {
        draft: { filterField: 'status', path: 'customers', sortField: 'updatedAt' },
      },
    });
  });

  it('uses legacy active history when no draft exists', async () => {
    const settings = settingsWithWorkspace({ ...persistedWorkspaceV1, drafts: {} });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      tabsState: {
        tabs: [{ draft: { filters: [], path: 'orders', sortField: '' } }, {}],
      },
    });
  });

  it('drops orphan legacy drafts and reports one recovery diagnostic', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspaceV1,
      drafts: {
        ...persistedWorkspaceV1.drafts,
        'closed-tab': firestoreDraft,
        'tab-js-1': firestoreDraft,
      },
    });

    await expect(loadPersistedWorkspaceStateResult(settings)).resolves.toMatchObject({
      error: null,
      migrated: true,
      recoveryDiagnostic: 'Recovered workspace state; ignored orphan or mismatched tab records.',
      snapshot: { version: 2 },
    });
  });

  it('reports dropped orphan legacy tool records once', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspaceV1,
      scripts: { ...persistedWorkspaceV1.scripts, 'closed-tab': 'return 2;' },
    });

    await expect(loadPersistedWorkspaceStateResult(settings)).resolves.toMatchObject({
      error: null,
      migrated: true,
      recoveryDiagnostic: 'Recovered workspace state; ignored orphan or mismatched tab records.',
      snapshot: { scripts: { 'tab-js-1': 'return 1;' } },
    });
  });

  it('clamps legacy history before assigning the winning active draft', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspaceV1,
      tabsState: {
        ...persistedWorkspaceV1.tabsState,
        interactionHistory: [
          persistedWorkspaceV1.tabsState.interactionHistory[0],
          {
            activeTabId: 'tab-firestore-1',
            path: 'auditLogs',
            selectedTreeItemId: 'collection:emu:auditLogs',
          },
        ],
        interactionHistoryIndex: 99,
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      tabsState: {
        interactionHistory: [
          { location: { draft: { path: 'orders', sortField: '' } } },
          { location: { draft: { path: 'customers', sortField: 'updatedAt' } } },
        ],
        interactionHistoryIndex: 1,
      },
    });
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

  it('preserves unsupported future workspace state without writing it back', async () => {
    const futureWorkspace = { version: 3, savedAt: 500, tabsState: { future: true } };
    const settings = settingsWithWorkspace(futureWorkspace);
    const save = vi.spyOn(settings, 'save');

    await expect(loadPersistedWorkspaceStateResult(settings)).resolves.toEqual({
      error: {
        message: 'Saved workspace version 3 is newer than this app. Persistence is disabled.',
        operation: 'load',
      },
      snapshot: null,
      unsupportedVersion: 3,
    });
    await expect(savePersistedWorkspaceState(settings, withoutVersion(persistedWorkspace)))
      .resolves.toBeNull();

    expect(save).not.toHaveBeenCalled();
    expect(settings.workspaceState).toEqual(futureWorkspace);
  });

  it('allows an explicit clear after protecting a future workspace version', async () => {
    const settings = settingsWithWorkspace({ version: 3, future: true });
    await loadPersistedWorkspaceStateResult(settings);

    await expect(clearPersistedWorkspaceState(settings, 700)).resolves.toBeNull();

    expect(settings.workspaceState).toBeNull();
    expect(settings.workspaceStateClearedAt).toBe(700);
  });

  it('does not restore invalid workspace state', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: { ...persistedWorkspace.tabsState, activeTabId: 'missing-tab' },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toBeNull();
    await expect(loadPersistedWorkspaceStateResult(settings)).resolves.toMatchObject({
      error: { operation: 'load' },
    });
  });

  it('does not restore invalid tool tab history state', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        tabs: [
          persistedWorkspace.tabsState.tabs[0]!,
          { ...persistedWorkspace.tabsState.tabs[1]!, historyIndex: 1 },
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
            location: { kind: 'tool', connectionId: 'emu', path: 'closed' },
            selectedTreeItemId: 'collection:emu:closed',
          },
        ],
        interactionHistoryIndex: 1,
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toEqual(persistedWorkspace);
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
            draft: { ...firestoreDraft, path: 'admin-leagues' },
          },
          persistedWorkspace.tabsState.tabs[1]!,
        ],
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      tabsState: {
        activeTabId: 'tab-firestore-1',
        tabs: [
          { id: 'tab-firestore-1', draft: { path: 'orders' } },
          { id: 'tab-firestore-1-2', draft: { path: 'admin-leagues' } },
          { id: 'tab-js-1', title: 'JS Query' },
        ],
      },
    });
  });

  it('remaps active history to the matching normalized duplicate id', async () => {
    const duplicateDraft = { ...firestoreDraft, path: 'admin-leagues' };
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        interactionHistory: [
          persistedWorkspace.tabsState.interactionHistory[0],
          {
            activeTabId: 'tab-firestore-1',
            location: {
              kind: 'firestore-query',
              connectionId: 'emu',
              draft: duplicateDraft,
            },
            selectedTreeItemId: 'collection:emu:admin-leagues',
          },
        ],
        interactionHistoryIndex: 1,
        tabs: [
          persistedWorkspace.tabsState.tabs[0],
          { ...persistedWorkspace.tabsState.tabs[0], draft: duplicateDraft },
          persistedWorkspace.tabsState.tabs[1],
        ],
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      tabsState: {
        activeTabId: 'tab-firestore-1-2',
        interactionHistory: [
          { activeTabId: 'tab-firestore-1' },
          { activeTabId: 'tab-firestore-1-2' },
        ],
        interactionHistoryIndex: 1,
      },
    });
  });

  it('remaps version 2 keyed state across mixed duplicate ids and generated collisions', async () => {
    const settings = settingsWithWorkspace(workspaceWithDuplicateToolIds());

    await expect(loadPersistedWorkspaceState(settings)).resolves.toMatchObject({
      scripts: { tool: 'return 1;' },
      fdqlSources: { 'tool-2': 'from orders' },
      sqlContexts: { 'tool-2-2': { defaultProjectId: 'emu' } },
      sqlSources: { 'tool-2-2': 'select * from orders' },
      tabsState: {
        tabs: [
          { id: 'tab-firestore-1' },
          { id: 'tool', kind: 'js-query' },
          { id: 'tool-2', kind: 'fdql' },
          { id: 'tool-2-2', kind: 'firestore-sql' },
        ],
      },
    });
  });

  it('does not restore invalid Firestore draft state', async () => {
    const settings = settingsWithWorkspace({
      ...persistedWorkspace,
      tabsState: {
        ...persistedWorkspace.tabsState,
        tabs: [{
          ...persistedWorkspace.tabsState.tabs[0]!,
          draft: { ...firestoreDraft, filterOp: 'contains' },
        }, persistedWorkspace.tabsState.tabs[1]!],
      },
    });

    await expect(loadPersistedWorkspaceState(settings)).resolves.toBeNull();
  });

  it('saves version 2 tab state and drops orphan feature records', async () => {
    const settings = settingsWithWorkspace(null);

    await expect(savePersistedWorkspaceState(settings, {
      ...withoutVersion(persistedWorkspace),
      scripts: { ...persistedWorkspace.scripts, 'closed-tab': 'return 2;' },
      fdqlSources: { 'closed-tab': 'from orders' },
    })).resolves.toBeNull();

    const saved = settings.workspaceState as PersistedWorkspaceState;
    expect(saved.tabsState.tabs[0]).toMatchObject({
      id: 'tab-firestore-1',
      draft: { path: 'orders' },
      inspectorUi: { overviewCollapsed: false, resultView: 'tree' },
    });
    const raw = JSON.stringify(settings.workspaceState);
    expect(raw).not.toContain('closed-tab');
    expect(raw).not.toContain('queryRequests');
    expect(raw).not.toContain('drafts');
    expect(raw).not.toContain('firestoreInspectorUi');
  });

  it('remaps keyed state when normalizing duplicate ids during save', async () => {
    const settings = settingsWithWorkspace(null);
    const duplicateWorkspace = workspaceWithDuplicateToolIds();

    await expect(savePersistedWorkspaceState(settings, withoutVersion(duplicateWorkspace)))
      .resolves.toBeNull();

    expect(settings.workspaceState).toMatchObject({
      scripts: { tool: 'return 1;' },
      fdqlSources: { 'tool-2': 'from orders' },
      sqlContexts: { 'tool-2-2': { defaultProjectId: 'emu' } },
      sqlSources: { 'tool-2-2': 'select * from orders' },
      tabsState: {
        tabs: [
          { id: 'tab-firestore-1' },
          { id: 'tool', kind: 'js-query' },
          { id: 'tool-2', kind: 'fdql' },
          { id: 'tool-2-2', kind: 'firestore-sql' },
        ],
      },
    });
  });

  it('saves only open-tab interaction history', async () => {
    const settings = settingsWithWorkspace(null);

    await expect(savePersistedWorkspaceState(settings, {
      ...withoutVersion(persistedWorkspace),
      tabsState: {
        ...persistedWorkspace.tabsState,
        interactionHistory: [
          ...persistedWorkspace.tabsState.interactionHistory,
          {
            activeTabId: 'closed-tab',
            location: { kind: 'tool', connectionId: 'emu', path: 'closed' },
            selectedTreeItemId: 'collection:emu:closed',
          },
        ],
        interactionHistoryIndex: 1,
      },
    }, { recordedAtMs: 300 })).resolves.toBeNull();

    expect(JSON.stringify(settings.workspaceState)).not.toContain('closed-tab');
    expect(settings.workspaceState).toMatchObject({
      savedAt: 300,
      tabsState: { interactionHistoryIndex: 0 },
    });
  });

  it('serializes saves and coalesces queued snapshots to the latest state', async () => {
    const settings = deferredSaveSettings();

    const first = savePersistedWorkspaceState(
      settings,
      withoutVersion(workspaceAtPath('orders')),
      { recordedAtMs: 100 },
    );
    const second = savePersistedWorkspaceState(
      settings,
      withoutVersion(workspaceAtPath('customers')),
      { recordedAtMs: 200 },
    );
    const third = savePersistedWorkspaceState(
      settings,
      withoutVersion(workspaceAtPath('invoices')),
      { recordedAtMs: 300 },
    );

    expect(settings.save).toHaveBeenCalledTimes(1);
    settings.pending[0]!.resolve(settingsSnapshot(null));
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.save).toHaveBeenCalledTimes(2);
    const latest = settings.save.mock.calls[1]?.[0].workspaceState as PersistedWorkspaceState;
    expect(latest.tabsState.tabs[0]).toMatchObject({ draft: { path: 'invoices' } });
    expect(latest.savedAt).toBe(300);

    settings.pending[1]!.resolve(settingsSnapshot(null));
    await expect(Promise.all([first, second, third])).resolves.toEqual([null, null, null]);
  });

  it('continues queued saves after an earlier save fails', async () => {
    const settings = deferredSaveSettings();

    const first = savePersistedWorkspaceState(settings, withoutVersion(workspaceAtPath('orders')));
    const second = savePersistedWorkspaceState(
      settings,
      withoutVersion(workspaceAtPath('customers')),
    );
    settings.pending[0]!.reject(new Error('disk unavailable'));
    await Promise.resolve();
    await Promise.resolve();
    settings.pending[1]!.resolve(settingsSnapshot(null));

    await expect(first).resolves.toEqual({ message: 'disk unavailable', operation: 'save' });
    await expect(second).resolves.toBeNull();
  });

  it('applies a queued workspace clear after an in-flight snapshot save', async () => {
    const settings = deferredSaveSettings();

    const first = savePersistedWorkspaceState(
      settings,
      withoutVersion(workspaceAtPath('orders')),
      { recordedAtMs: 100 },
    );
    const clear = savePersistedWorkspaceState(settings, {
      authFilter: '',
      scripts: {},
      tabsState: {
        activeTabId: '',
        interactionHistory: [],
        interactionHistoryIndex: 0,
        selectedTreeItemId: null,
        tabs: [],
      },
    }, { recordedAtMs: 200 });

    settings.pending[0]!.resolve(settingsSnapshot(null));
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.save.mock.calls[1]?.[0]).toEqual({
      workspaceState: null,
      workspaceStateClearedAt: 200,
    });
    settings.pending[1]!.resolve(settingsSnapshot(null));
    await expect(Promise.all([first, clear])).resolves.toEqual([null, null]);
  });

  it('removes storage when no tabs are open', async () => {
    const settings = settingsWithWorkspace(persistedWorkspace);

    await expect(savePersistedWorkspaceState(settings, {
      authFilter: '',
      scripts: {},
      tabsState: {
        activeTabId: '',
        interactionHistory: [],
        interactionHistoryIndex: 0,
        selectedTreeItemId: null,
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

    await expect(savePersistedWorkspaceState(settings, withoutVersion(persistedWorkspace)))
      .resolves.toEqual({
        message: 'settings unavailable',
        operation: 'save',
      });
  });
});

function withoutVersion(
  workspace: PersistedWorkspaceState,
): Omit<PersistedWorkspaceState, 'version'> {
  const { version: _version, ...state } = workspace;
  return state;
}

function workspaceAtPath(path: string): PersistedWorkspaceState {
  const firestoreTab = persistedWorkspace.tabsState.tabs[0]!;
  if (firestoreTab.kind !== 'firestore-query') throw new Error('Expected Firestore tab fixture.');
  return {
    ...persistedWorkspace,
    tabsState: {
      ...persistedWorkspace.tabsState,
      interactionHistory: [{
        activeTabId: 'tab-firestore-1',
        location: {
          kind: 'firestore-query',
          connectionId: 'emu',
          draft: { ...firestoreDraft, path },
        },
        selectedTreeItemId: `collection:emu:${path}`,
      }],
      selectedTreeItemId: `collection:emu:${path}`,
      tabs: [{
        ...firestoreTab,
        draft: { ...firestoreDraft, path },
      }, persistedWorkspace.tabsState.tabs[1]!],
    },
  };
}

function workspaceWithDuplicateToolIds(): PersistedWorkspaceState {
  return {
    ...persistedWorkspace,
    scripts: { tool: 'return 1;' },
    fdqlSources: { tool: 'from orders' },
    sqlContexts: { 'tool-2': { defaultProjectId: 'emu' } },
    sqlSources: { 'tool-2': 'select * from orders' },
    tabsState: {
      ...persistedWorkspace.tabsState,
      tabs: [
        persistedWorkspace.tabsState.tabs[0]!,
        {
          id: 'tool',
          kind: 'js-query',
          title: 'JavaScript Query',
          connectionId: 'emu',
          history: ['scripts/default'],
          historyIndex: 0,
          inspectorWidth: 360,
        },
        {
          id: 'tool',
          kind: 'fdql',
          title: 'FDQL',
          connectionId: 'emu',
          history: ['fdql/default'],
          historyIndex: 0,
          inspectorWidth: 360,
        },
        {
          id: 'tool-2',
          kind: 'firestore-sql',
          title: 'Firestore SQL',
          connectionId: 'emu',
          history: ['sql/default'],
          historyIndex: 0,
          inspectorWidth: 360,
        },
      ],
    },
  };
}

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
    async save(patch: SettingsPatch) {
      if ('workspaceState' in patch) this.workspaceState = patch.workspaceState ?? null;
      if ('workspaceStateClearedAt' in patch) {
        this.workspaceStateClearedAt = patch.workspaceStateClearedAt ?? null;
      }
      return settingsSnapshot(this.workspaceState, this.workspaceStateClearedAt);
    },
  };
}

function deferredSaveSettings(): Pick<SettingsRepository, 'save'> & {
  readonly pending: Array<{
    readonly reject: (error: unknown) => void;
    readonly resolve: (snapshot: SettingsSnapshot) => void;
  }>;
  readonly save: ReturnType<typeof vi.fn<SettingsRepository['save']>>;
} {
  const pending: Array<{
    readonly reject: (error: unknown) => void;
    readonly resolve: (snapshot: SettingsSnapshot) => void;
  }> = [];
  return {
    pending,
    save: vi.fn((patch: SettingsPatch) => {
      void patch;
      return new Promise<SettingsSnapshot>((resolve, reject) => {
        pending.push({ reject, resolve });
      });
    }),
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
