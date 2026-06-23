import { createProjectFixture } from '@firebase-desk/repo-mocks';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppShellController, AppShellOrchestratorInput } from '../appShellOrchestrator.ts';
import type { RepositorySet } from '../RepositoryProvider.tsx';
import { type SelectionState, selectionStore } from '../stores/selectionStore.ts';
import { type TabsState, tabsStore, type WorkspaceTab } from '../stores/tabsStore.ts';
import { clampSidebarWidth } from '../workspaceModel.ts';
import { useAppShellController } from './useAppShellController.ts';

const mocks = vi.hoisted(() => ({
  createAppShellController: vi.fn(),
  useActivityController: vi.fn(),
  useAppearance: vi.fn(),
  useAppShellHotkeys: vi.fn(),
  useAuthTabState: vi.fn(),
  useDestructiveActionController: vi.fn(),
  useDocumentDensity: vi.fn(),
  useFdqlTabState: vi.fn(),
  useFirestoreSqlTabState: vi.fn(),
  useFirestoreTabState: vi.fn(),
  useFirestoreWriteController: vi.fn(),
  useJsTabState: vi.fn(),
  useJobsController: vi.fn(),
  usePersistWorkspaceSnapshot: vi.fn(),
  usePersistedWorkspaceState: vi.fn(),
  useProjectCommandController: vi.fn(),
  useProjects: vi.fn(),
  useRepositories: vi.fn(),
  useSelector: vi.fn(),
  useSettingsController: vi.fn(),
  useUpdateController: vi.fn(),
  useWorkspaceTree: vi.fn(),
}));

vi.mock('@firebase-desk/product-ui', () => ({
  useAppearance: mocks.useAppearance,
}));

vi.mock('@tanstack/react-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-store')>()),
  useSelector: mocks.useSelector,
}));

vi.mock('../../app-core/activity/useActivityController.ts', () => ({
  useActivityController: mocks.useActivityController,
}));

vi.mock('../../app-core/firestore/write/useFirestoreWriteController.ts', () => ({
  useFirestoreWriteController: mocks.useFirestoreWriteController,
}));

vi.mock('../../app-core/jobs/useJobsController.ts', () => ({
  useJobsController: mocks.useJobsController,
}));

vi.mock('../../app-core/settings/useSettingsController.ts', () => ({
  useSettingsController: mocks.useSettingsController,
}));

vi.mock('../../app-core/updates/useUpdateController.ts', () => ({
  useUpdateController: mocks.useUpdateController,
}));

vi.mock('../appShellOrchestrator.ts', () => ({
  createAppShellController: mocks.createAppShellController,
}));

vi.mock('../RepositoryProvider.tsx', () => ({
  useRepositories: mocks.useRepositories,
}));

vi.mock('./useAppShellHotkeys.ts', () => ({
  useAppShellHotkeys: mocks.useAppShellHotkeys,
}));

vi.mock('./useAuthTabState.ts', () => ({
  useAuthTabState: mocks.useAuthTabState,
}));

vi.mock('./useDestructiveActionController.ts', () => ({
  useDestructiveActionController: mocks.useDestructiveActionController,
}));

vi.mock('./useDocumentDensity.ts', () => ({
  useDocumentDensity: mocks.useDocumentDensity,
}));

vi.mock('./useFirestoreTabState.ts', () => ({
  useFirestoreTabState: mocks.useFirestoreTabState,
}));

vi.mock('./useFdqlTabState.ts', () => ({
  useFdqlTabState: mocks.useFdqlTabState,
}));

vi.mock('./useFirestoreSqlTabState.ts', () => ({
  useFirestoreSqlTabState: mocks.useFirestoreSqlTabState,
}));

vi.mock('./useJsTabState.ts', () => ({
  useJsTabState: mocks.useJsTabState,
}));

vi.mock('./usePersistedWorkspaceState.ts', () => ({
  usePersistedWorkspaceState: mocks.usePersistedWorkspaceState,
  usePersistWorkspaceSnapshot: mocks.usePersistWorkspaceSnapshot,
}));

vi.mock('./useProjectCommandController.ts', () => ({
  useProjectCommandController: mocks.useProjectCommandController,
}));

vi.mock('./useProjects.ts', () => ({
  useProjects: mocks.useProjects,
}));

vi.mock('./useWorkspaceTree.ts', () => ({
  useWorkspaceTree: mocks.useWorkspaceTree,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--sidebar-width');
});

describe('useAppShellController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as { firebaseDesk?: unknown; }).firebaseDesk;
  });

  it('builds the orchestrator input from hook and store state', () => {
    const scenario = createScenario({
      tabsState: tabsState([firestoreTab('tab-first', 'emu')], 'missing-tab'),
    });
    setupMocks(scenario);

    const { result } = renderHook(() =>
      useAppShellController({ appVersion: '0.1.0', initialSidebarWidth: 999 })
    );

    const input = expectControllerInput();
    expect(result.current).toBe(scenario.controller);
    expect(input.activeTab).toBe(scenario.tabsState.tabs[0]);
    expect(input.activeProject).toBe(scenario.project);
    expect(input.layout.sidebarDefaultWidth).toBe(clampSidebarWidth(999));
    expect(input.selection).toBe(scenario.selection);
    expect(input.tabsState).toBe(scenario.tabsState);
    expect(mocks.useAppShellHotkeys).toHaveBeenCalledWith(scenario.controller.hotkeys);
  });

  it('passes restored workspace state into feature hooks and persistence snapshot', () => {
    const tab = firestoreTab('tab-firestore', 'emu');
    const scenario = createScenario({
      authFilter: 'ada',
      drafts: {
        [tab.id]: {
          path: 'customers',
          filters: [],
          filterField: '',
          filterOp: '==',
          filterValue: '',
          sortField: '',
          sortDirection: 'desc',
          limit: 7,
        },
      },
      scripts: { 'tab-js': 'yield 1;' },
      tabsState: tabsState([tab], tab.id),
    });
    setupMocks(scenario);

    renderHook(() => useAppShellController({ appVersion: '0.1.0' }));

    expect(mocks.useFirestoreTabState).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProject: scenario.project,
        activeTab: tab,
        initialDrafts: scenario.persistedWorkspace.snapshot?.drafts,
        initialInspectorUi: scenario.persistedWorkspace.snapshot?.firestoreInspectorUi,
        onQueryActivity: scenario.activity.record,
        selectedTreeItemId: scenario.selection.treeItemId,
      }),
    );
    expect(mocks.useAuthTabState).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProject: scenario.project,
        activeTab: tab,
        initialAuthFilter: 'ada',
        recordActivity: scenario.activity.record,
        selectedUserId: scenario.selection.authUserId,
      }),
    );
    expect(mocks.useJsTabState).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTab: tab,
        initialScripts: scenario.persistedWorkspace.snapshot?.scripts,
        recordActivity: scenario.activity.record,
        selectedTreeItemId: scenario.selection.treeItemId,
      }),
    );
    expect(mocks.usePersistWorkspaceSnapshot).toHaveBeenCalledWith(
      {
        authFilter: 'ada',
        drafts: scenario.firestoreTab.drafts,
        fdqlSources: scenario.fdqlTab.sources,
        firestoreInspectorUi: scenario.firestoreTab.inspectorUi,
        scripts: scenario.jsTab.scripts,
        sqlContexts: scenario.sqlTab.contexts,
        sqlSources: scenario.sqlTab.sources,
        tabsState: scenario.tabsState,
      },
      expect.objectContaining({
        enabled: true,
        settings: scenario.repositories.settings,
      }),
    );
  });

  it('collapses narrow sidebar resizes and persists wider sidebar widths', async () => {
    const save = vi.fn();
    const scenario = createScenario({
      repositories: createRepositories({ save }),
    });
    setupMocks(scenario);

    renderHook(() => useAppShellController({ appVersion: '0.1.0' }));
    const input = expectControllerInput();

    input.layout.onSidebarResize(10);

    await waitFor(() => expect(lastControllerInput().layout.sidebarCollapsed).toBe(true));
    expect(save).not.toHaveBeenCalled();

    input.layout.onSidebarResize(220);

    const width = clampSidebarWidth(220);
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe(`${width}px`);
    expect(save).toHaveBeenCalledWith({ sidebarWidth: width });
  });

  it('passes desktop app access into settings and dialogs', () => {
    const desktopAppApi = { openDataDirectory: vi.fn() };
    Object.defineProperty(window, 'firebaseDesk', {
      configurable: true,
      value: { app: desktopAppApi },
    });
    const scenario = createScenario();
    setupMocks(scenario);

    renderHook(() => useAppShellController({ appVersion: '0.1.0', dataMode: 'live' }));

    expect(mocks.useSettingsController).toHaveBeenCalledWith(
      expect.objectContaining({ dataDirectoryApi: desktopAppApi }),
    );
    expect(expectControllerInput()).toEqual(
      expect.objectContaining({
        canOpenDataDirectory: true,
        dataMode: 'live',
      }),
    );
  });

  it('handles settings load failure when restoring density', async () => {
    const scenario = createScenario({
      repositories: createRepositories({
        load: vi.fn(async () => {
          throw new Error('settings unreadable');
        }),
      }),
    });
    setupMocks(scenario);

    renderHook(() => useAppShellController({ appVersion: '0.1.0' }));

    await waitFor(() => {
      expect(mocks.createAppShellController).toHaveBeenLastCalledWith(
        expect.objectContaining({
          density: 'compact',
          lastAction: 'Settings load failed: settings unreadable',
        }),
      );
    });
  });

  it('opens first-run guide for incomplete mock mode settings', async () => {
    const scenario = createScenario();
    setupMocks(scenario);

    renderHook(() => useAppShellController({ appVersion: '0.1.0', dataMode: 'mock' }));

    await waitFor(() => {
      expect(mocks.createAppShellController).toHaveBeenLastCalledWith(
        expect.objectContaining({
          firstRunGuide: expect.objectContaining({ open: true }),
        }),
      );
    });
  });

  it('keeps first-run guide closed in demo mode', async () => {
    const scenario = createScenario();
    setupMocks(scenario);

    renderHook(() =>
      useAppShellController({ appVersion: '0.1.0', dataMode: 'mock', demoMode: true })
    );

    await waitFor(() => {
      expect(mocks.createAppShellController).toHaveBeenLastCalledWith(
        expect.objectContaining({
          demoMode: true,
          firstRunGuide: expect.objectContaining({ open: false }),
        }),
      );
    });
  });
});

interface Scenario {
  readonly activity: ReturnType<typeof createActivity>;
  readonly authFilter: string;
  readonly authTab: ReturnType<typeof createAuthTab>;
  readonly controller: AppShellController;
  readonly destructiveAction: ReturnType<typeof createDestructiveAction>;
  readonly drafts: Record<string, unknown>;
  readonly fdqlTab: ReturnType<typeof createFdqlTab>;
  readonly firestoreTab: ReturnType<typeof createFirestoreTab>;
  readonly firestoreWrite: ReturnType<typeof createFirestoreWrite>;
  readonly jsTab: ReturnType<typeof createJsTab>;
  readonly jobs: ReturnType<typeof createJobs>;
  readonly persistedWorkspace: {
    readonly restored: boolean;
    readonly snapshot: {
      readonly authFilter: string;
      readonly drafts: Record<string, unknown>;
      readonly fdqlSources: Record<string, string>;
      readonly firestoreInspectorUi: Record<string, unknown>;
      readonly scripts: Record<string, string>;
      readonly sqlContexts: Record<string, unknown>;
      readonly sqlSources: Record<string, string>;
    };
  };
  readonly project: ReturnType<typeof createProjectFixture>;
  readonly projectCommands: ReturnType<typeof createProjectCommands>;
  readonly projectsQuery: ReturnType<typeof createProjectsQuery>;
  readonly repositories: RepositorySet;
  readonly scripts: Record<string, string>;
  readonly selection: SelectionState;
  readonly settings: ReturnType<typeof createSettings>;
  readonly sqlTab: ReturnType<typeof createSqlTab>;
  readonly tabsState: TabsState;
  readonly updates: ReturnType<typeof createUpdates>;
  readonly workspaceTree: ReturnType<typeof createWorkspaceTree>;
}

function setupMocks(scenario: Scenario) {
  mocks.createAppShellController.mockReturnValue(scenario.controller);
  mocks.useActivityController.mockReturnValue(scenario.activity);
  mocks.useAppearance.mockReturnValue({
    mode: 'system',
    resolvedTheme: 'dark',
    setMode: vi.fn(),
  });
  mocks.useAuthTabState.mockReturnValue(scenario.authTab);
  mocks.useDestructiveActionController.mockReturnValue(scenario.destructiveAction);
  mocks.useFdqlTabState.mockReturnValue(scenario.fdqlTab);
  mocks.useFirestoreSqlTabState.mockReturnValue(scenario.sqlTab);
  mocks.useFirestoreTabState.mockReturnValue(scenario.firestoreTab);
  mocks.useFirestoreWriteController.mockReturnValue(scenario.firestoreWrite);
  mocks.useJsTabState.mockReturnValue(scenario.jsTab);
  mocks.useJobsController.mockReturnValue(scenario.jobs);
  mocks.usePersistedWorkspaceState.mockReturnValue(scenario.persistedWorkspace);
  mocks.useProjectCommandController.mockReturnValue(scenario.projectCommands);
  mocks.useProjects.mockReturnValue(scenario.projectsQuery);
  mocks.useRepositories.mockReturnValue(scenario.repositories);
  mocks.useSelector.mockImplementation((store, selector: (state: unknown) => unknown) => {
    if (store === tabsStore) return selector(scenario.tabsState);
    if (store === selectionStore) return selector(scenario.selection);
    throw new Error('Unexpected store selector.');
  });
  mocks.useSettingsController.mockReturnValue(scenario.settings);
  mocks.useUpdateController.mockReturnValue(scenario.updates);
  mocks.useWorkspaceTree.mockReturnValue(scenario.workspaceTree);
}

function expectControllerInput(): AppShellOrchestratorInput {
  expect(mocks.createAppShellController).toHaveBeenCalledTimes(1);
  const call = mocks.createAppShellController.mock.calls[0];
  if (!call) throw new Error('Expected createAppShellController call.');
  return call[0] as AppShellOrchestratorInput;
}

function lastControllerInput(): AppShellOrchestratorInput {
  const call = mocks.createAppShellController.mock.calls.at(-1);
  if (!call) throw new Error('Expected createAppShellController call.');
  return call[0] as AppShellOrchestratorInput;
}

function createScenario(
  {
    authFilter = '',
    drafts = {},
    fdqlSources = {},
    firestoreInspectorUi = {},
    repositories = createRepositories(),
    scripts = {},
    sqlContexts = {},
    sqlSources = {},
    selection = {
      authUserId: 'u_ada',
      treeItemId: 'collection:emu:orders',
    },
    tabsState: state = tabsState([firestoreTab('tab-orders', 'emu')], 'tab-orders'),
  }: {
    readonly authFilter?: string;
    readonly drafts?: Record<string, unknown>;
    readonly fdqlSources?: Record<string, string>;
    readonly firestoreInspectorUi?: Record<string, unknown>;
    readonly repositories?: RepositorySet;
    readonly scripts?: Record<string, string>;
    readonly sqlContexts?: Record<string, unknown>;
    readonly sqlSources?: Record<string, string>;
    readonly selection?: SelectionState;
    readonly tabsState?: TabsState;
  } = {},
): Scenario {
  const project = createProjectFixture({ id: 'emu', name: 'Local Emulator' });
  const activity = createActivity();
  const firestoreTabState = createFirestoreTab({ drafts });
  const fdqlTab = createFdqlTab({ sources: fdqlSources });
  const jsTab = createJsTab({ scripts });
  const sqlTab = createSqlTab({ contexts: sqlContexts, sources: sqlSources });
  return {
    activity,
    authFilter,
    authTab: createAuthTab({ authFilter }),
    controller: createController(),
    destructiveAction: createDestructiveAction(),
    drafts,
    fdqlTab,
    firestoreTab: firestoreTabState,
    firestoreWrite: createFirestoreWrite(),
    jsTab,
    jobs: createJobs(),
    persistedWorkspace: {
      restored: true,
      snapshot: {
        authFilter,
        drafts,
        fdqlSources,
        firestoreInspectorUi,
        scripts,
        sqlContexts,
        sqlSources,
      },
    },
    project,
    projectCommands: createProjectCommands(),
    projectsQuery: createProjectsQuery(project),
    repositories,
    scripts,
    selection,
    settings: createSettings(),
    sqlTab,
    tabsState: state,
    updates: createUpdates(),
    workspaceTree: createWorkspaceTree(),
  };
}

function createRepositories(
  {
    load = vi.fn(async () => ({
      density: 'compact' as const,
      firstRunGuide: { completedAt: null },
    })),
    save = vi.fn(),
  }: {
    readonly load?: () => Promise<{
      readonly density: 'compact';
      readonly firstRunGuide: { readonly completedAt: string | null; };
    }>;
    readonly save?: (patch: unknown) => unknown;
  } = {},
) {
  return {
    activity: {},
    auth: {},
    fdql: {
      cancel: vi.fn(),
      compile: vi.fn(),
      run: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    },
    firestore: { listSubcollections: vi.fn() },
    jobs: {
      cancel: vi.fn(),
      clearCompleted: vi.fn(),
      list: vi.fn(),
      pickExportFile: vi.fn(),
      pickImportFile: vi.fn(),
      start: vi.fn(),
      subscribe: vi.fn(),
    },
    projects: {},
    scriptRunner: {},
    settings: { load, save },
  } as unknown as RepositorySet;
}

function createController(): AppShellController {
  return {
    hotkeys: {
      activeTabKind: null,
      onBack: vi.fn(),
      onCloseTab: vi.fn(),
      onFocusSearch: vi.fn(),
      onForward: vi.fn(),
      onNewTab: vi.fn(),
      onOpenSettings: vi.fn(),
      onRunQuery: vi.fn(),
      onRunScript: vi.fn(),
    },
  } as unknown as AppShellController;
}

function createActivity() {
  return {
    button: { badge: null, variant: 'ghost' as const },
    clear: vi.fn(),
    close: vi.fn(),
    drawer: {
      area: 'all' as const,
      entries: [],
      expanded: false,
      isLoading: false,
      open: false,
      search: '',
      status: 'all' as const,
    },
    exportEntries: vi.fn(),
    openTargetIntent: vi.fn(() => null),
    record: vi.fn(),
    setArea: vi.fn(),
    setExpanded: vi.fn(),
    setSearch: vi.fn(),
    setStatus: vi.fn(),
    toggle: vi.fn(),
  };
}

function createAuthTab({ authFilter = '' }: { readonly authFilter?: string; } = {}) {
  return {
    authFilter,
    clear: vi.fn(),
    errorMessage: null,
    isTabLoading: vi.fn(() => false),
    loadMore: vi.fn(),
    refetch: vi.fn(),
    saveCustomClaims: vi.fn(),
    selectedUser: null,
    setAuthFilter: vi.fn(),
    users: [],
    usersHasMore: false,
    usersIsFetchingMore: false,
    usersIsLoading: false,
  };
}

function createDestructiveAction() {
  return {
    pendingAction: null,
    request: vi.fn(),
    setOpen: vi.fn(),
  };
}

function createFirestoreTab(
  { drafts = {} }: { readonly drafts?: Record<string, unknown>; } = {},
) {
  return {
    activeDraft: {
      path: 'orders',
      filters: [],
      filterField: '',
      filterOp: '==',
      filterValue: '',
      sortField: '',
      sortDirection: 'desc',
      limit: 25,
    },
    activeInspectorUi: {
      overviewCollapsed: false,
      resultTreeExpandedIds: null,
      sections: {
        fieldsInResults: false,
        jsonContext: true,
        selectionPreview: true,
      },
      selectionPreviewExpandedPathsByDocumentPath: {},
    },
    clearTab: vi.fn(),
    duplicateTab: vi.fn(),
    drafts,
    errorMessage: null,
    hasMore: false,
    isFetchingMore: false,
    isLoading: false,
    isTabLoading: vi.fn(() => false),
    loadMore: vi.fn(),
    openTab: vi.fn(() => 'tab-opened'),
    openTabInNewTab: vi.fn(() => 'tab-opened-new'),
    queryRows: [],
    refreshQuery: vi.fn(() => 'orders'),
    resetDraft: vi.fn(),
    resultView: 'table' as const,
    resultsStale: false,
    runQuery: vi.fn(() => 'orders'),
    selectDocument: vi.fn(),
    selectedDocument: null,
    selectedDocumentPath: null,
    setDraft: vi.fn(),
    setInspectorOverviewCollapsed: vi.fn(),
    setInspectorSectionOpen: vi.fn(),
    setResultView: vi.fn(),
    setResultTreeExpandedIds: vi.fn(),
    setResultsStale: vi.fn(),
    setSelectionPreviewExpandedPaths: vi.fn(),
    inspectorUi: {},
  };
}

function createFirestoreWrite() {
  return {
    createDocument: vi.fn(),
    createDocumentRequest: null,
    deleteDocument: vi.fn(),
    generateDocumentId: vi.fn(),
    handleCreateDocumentRequestHandled: vi.fn(),
    requestCreateDocument: vi.fn(),
    saveDocument: vi.fn(),
    updateDocumentFields: vi.fn(),
  };
}

function createJsTab({ scripts = {} }: { readonly scripts?: Record<string, string>; } = {}) {
  return {
    cancelScript: vi.fn(() => false),
    clearTab: vi.fn(),
    clearTabRuntime: vi.fn(),
    duplicateTab: vi.fn(),
    isRunning: false,
    isTabRunning: vi.fn(() => false),
    runScript: vi.fn(() => false),
    scriptResult: undefined,
    scriptRunId: null,
    scriptSource: 'yield 1;',
    scriptStartedAt: null,
    scripts,
    setScriptSource: vi.fn(),
  };
}

function createFdqlTab(
  { sources = {} }: { readonly sources?: Record<string, string>; } = {},
) {
  return {
    cancel: vi.fn(() => false),
    clearTab: vi.fn(),
    clearTabRuntime: vi.fn(),
    compileResult: null,
    duplicateTab: vi.fn(),
    isRunning: false,
    isTabRunning: vi.fn(() => false),
    result: null,
    run: vi.fn(() => false),
    runId: null,
    runStartedAt: null,
    setSource: vi.fn(),
    source: 'from $orders as o\nreturn o',
    sources,
  };
}

function createSqlTab(
  {
    contexts = {},
    sources = {},
  }: {
    readonly contexts?: Record<string, unknown>;
    readonly sources?: Record<string, string>;
  } = {},
) {
  return {
    cancel: vi.fn(() => false),
    clearTab: vi.fn(),
    compile: vi.fn(() => false),
    compileResult: null,
    context: {},
    contexts,
    duplicateTab: vi.fn(),
    isRunning: false,
    isTabRunning: vi.fn(() => false),
    result: null,
    run: vi.fn(() => false),
    runId: null,
    runStartedAt: null,
    setContext: vi.fn(),
    setSource: vi.fn(),
    source: 'select * from orders o',
    sources,
  };
}

function createJobs() {
  return {
    button: { badge: null, variant: 'ghost' as const },
    cancel: vi.fn(),
    clearCompleted: vi.fn(),
    close: vi.fn(),
    expanded: false,
    isLoading: false,
    jobs: [],
    load: vi.fn(),
    open: vi.fn(),
    opened: false,
    setExpanded: vi.fn(),
    start: vi.fn(),
    state: {
      errorMessage: null,
      expanded: false,
      isLoading: false,
      jobs: [],
      open: false,
    },
    toggle: vi.fn(),
  };
}

function createProjectCommands() {
  return {
    addProject: vi.fn(),
    removeProject: vi.fn(),
    updateProject: vi.fn(),
  };
}

function createProjectsQuery(project: ReturnType<typeof createProjectFixture>) {
  return {
    data: [project],
    reload: vi.fn(),
  };
}

function createSettings() {
  return {
    changeDensity: vi.fn(),
    changeTheme: vi.fn(),
    dataDirectoryPath: null,
    open: false,
    openDataDirectory: vi.fn(),
    openSettings: vi.fn(),
    recordSettingsSaved: vi.fn(),
    setOpen: vi.fn(),
  };
}

function createUpdates() {
  return {
    canCheck: true,
    check: vi.fn(),
    dismiss: vi.fn(),
    isChecking: false,
    notice: null,
    openRelease: vi.fn(),
    state: { status: 'idle' as const },
    statusLabel: null,
  };
}

function createWorkspaceTree() {
  return {
    handleOpenItem: vi.fn(),
    handleRefreshItem: vi.fn(),
    handleSelectItem: vi.fn(),
    handleToggleItem: vi.fn(),
    refreshLoadedRoots: vi.fn(),
    setTreeFilter: vi.fn(),
    treeFilter: '',
    treeItems: [],
  };
}

function tabsState(tabs: ReadonlyArray<WorkspaceTab>, activeTabId: string): TabsState {
  return {
    activeTabId,
    interactionHistory: [],
    interactionHistoryIndex: -1,
    tabs,
  };
}

function firestoreTab(id: string, connectionId: string): WorkspaceTab {
  return {
    connectionId,
    history: ['orders'],
    historyIndex: 0,
    id,
    inspectorWidth: 360,
    kind: 'firestore-query',
    title: 'orders',
  };
}
