import type { DensityName } from '@firebase-desk/design-tokens';
import type {
  AccountTree,
  CommandPaletteItem,
  FirestoreResultView,
  WorkspaceTabModel,
} from '@firebase-desk/product-ui';
import type {
  ActivityLogEntry,
  AuthUser,
  FdqlCompileResult,
  FdqlRunResult,
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreFieldPatchOperation,
  FirestoreQueryDraft,
  FirestoreQueryDraftEdit,
  FirestoreSaveDocumentOptions,
  FirestoreSaveDocumentResult,
  FirestoreSqlCompileResult,
  FirestoreSqlContext,
  FirestoreSqlRunResult,
  FirestoreUpdateDocumentFieldsOptions,
  FirestoreUpdateDocumentFieldsResult,
  ProjectAddInput,
  ProjectsRepository,
  ProjectSummary,
  ProjectUpdatePatch,
  ScriptRunResult,
  SettingsPatch,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import type {
  BackgroundJob,
  FirestoreCollectionJobRequest,
  FirestoreExportFormat,
} from '@firebase-desk/repo-contracts/jobs';
import type { Badge, IconButton } from '@firebase-desk/ui';
import type { ComponentProps } from 'react';
import {
  firestoreCollectionPathForTarget,
  firestoreDraftFingerprint,
} from '../app-core/firestore/query/firestoreQueryDraft.ts';
import type {
  FirestoreInspectorSectionId,
  FirestoreInspectorUiState,
  SubmittedFirestoreQuery,
} from '../app-core/firestore/query/firestoreQueryState.ts';
import { interactionLocationForTab, tabTitle } from '../app-core/workspace/workspaceState.ts';
import { createCommandPaletteModel } from './commandPaletteModel.ts';
import type { DestructiveAction } from './hooks/useDestructiveActionController.ts';
import type {
  InteractionHistoryEntry,
  OpenTabInput,
  TabsState,
  WorkspaceTab,
  WorkspaceTabKind,
} from './stores/tabsStore.ts';
import {
  authNodeId,
  COLLAPSED_SIDEBAR_WIDTH,
  collectionNodeId,
  DEFAULT_FIRESTORE_DRAFT,
  firestoreNodeId,
  MIN_SIDEBAR_WIDTH,
  parseTreeId,
  treeItemIdForTab,
} from './workspaceModel.ts';
import type { WorkspaceTabViewProps } from './WorkspaceTabView.tsx';

type AccountTreeProps = ComponentProps<typeof AccountTree>;

export interface AppShellController {
  readonly commands: ReadonlyArray<CommandPaletteItem>;
  readonly dialogs: {
    readonly addProjectOpen: boolean;
    readonly appVersion: string;
    readonly canOpenDataDirectory: boolean;
    readonly credentialWarning: string | null;
    readonly dataDirectoryPath: string | null | undefined;
    readonly density: DensityName;
    readonly destructiveAction: DestructiveAction | null;
    readonly editingProject: ProjectSummary | null;
    readonly firstRunGuideError: string | null;
    readonly firstRunGuideOpen: boolean;
    readonly firstRunGuideSaving: boolean;
    readonly projectsRepository: ProjectsRepository;
    readonly settingsOpen: boolean;
    readonly dataModeOptions?: readonly ('live' | 'mock')[] | undefined;
    readonly dataModeHelpText?: string | undefined;
    readonly onAddProjectOpenChange: (open: boolean) => void;
    readonly onCredentialWarningDismiss: () => void;
    readonly onDensityChange: (density: DensityName) => void;
    readonly onDestructiveActionOpenChange: (open: boolean) => void;
    readonly onEditProjectOpenChange: (open: boolean) => void;
    readonly onFirstRunGuideKeepMock: () => void;
    readonly onFirstRunGuideOpenChange: (open: boolean) => void;
    readonly onFirstRunGuideOpenSettings: () => void;
    readonly onFirstRunGuideSwitchToLive: () => void;
    readonly onOpenDataDirectory: () => Promise<void>;
    readonly onProjectAdded: (project: ProjectSummary) => void;
    readonly onProjectAddSubmit: (input: ProjectAddInput) => Promise<ProjectSummary>;
    readonly onProjectUpdateSubmit: (
      id: string,
      patch: ProjectUpdatePatch,
    ) => Promise<ProjectSummary>;
    readonly onSettingsOpenChange: (open: boolean) => void;
    readonly onSettingsSaved: (patch: SettingsPatch) => void;
  };
  readonly header: {
    readonly appVersion: string;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
    readonly canCheckForUpdates: boolean;
    readonly checkingForUpdates: boolean;
    readonly canAddProject: boolean;
    readonly dataMode: 'live' | 'mock';
    readonly demoMode: boolean;
    readonly mode: 'dark' | 'light' | 'system';
    readonly resolvedTheme: 'dark' | 'light';
    readonly updateStatusLabel: string | null;
    readonly onAddProject: () => void;
    readonly onBack: () => void;
    readonly onCheckForUpdates: () => void;
    readonly onForward: () => void;
    readonly onOpenMockGuide: () => void;
    readonly onModeChange: (mode: 'dark' | 'light' | 'system') => void;
    readonly onOpenSettings: () => void;
  };
  readonly hotkeys: {
    readonly activeTabKind: WorkspaceTabKind | null;
    readonly onBack: () => void;
    readonly onCloseTab: () => void;
    readonly onFocusSearch: () => void;
    readonly onForward: () => void;
    readonly onNewTab: () => void;
    readonly onOpenSettings: () => void;
    readonly onRunFdql: () => void;
    readonly onRunQuery: () => void;
    readonly onRunScript: () => void;
  };
  readonly layout: {
    readonly sidebarCollapsed: boolean;
    readonly sidebarDefaultWidth: number;
    readonly sidebarMaxSize?: string | undefined;
    readonly sidebarMinSize: string;
    readonly onSidebarResize: (size: number) => void;
  };
  readonly sidebar: {
    readonly collapsed: boolean;
    readonly density: DensityName;
    readonly filterValue: string;
    readonly items: AccountTreeProps['items'];
    readonly onAddProject?: (() => void) | undefined;
    readonly onCollapse: () => void;
    readonly onCreateCollection: (id: string) => void;
    readonly onCreateDocument: (id: string) => void;
    readonly onCollectionJob: (
      id: string,
      kind: 'copy' | 'delete' | 'duplicate' | 'export' | 'import',
    ) => void;
    readonly onEditItem?: ((id: string) => void) | undefined;
    readonly onExpand: () => void;
    readonly onFilterChange: (value: string) => void;
    readonly onOpenItem: (id: string) => void;
    readonly onRefreshItem: (id: string) => void;
    readonly onRemoveItem: (id: string) => void;
    readonly onSelectItem: (id: string) => void;
    readonly onToggleItem: (id: string) => void;
  };
  readonly tabView: WorkspaceTabViewProps | null;
  readonly workspace: {
    readonly activeProject: ProjectSummary | null;
    readonly activeTab: WorkspaceTab | undefined;
    readonly activeTabIsRefreshing: boolean;
    readonly activity: {
      readonly area: 'all' | ActivityLogEntry['area'];
      readonly buttonBadge: {
        readonly label: string;
        readonly variant: ComponentProps<typeof Badge>['variant'];
      } | null;
      readonly buttonVariant: ComponentProps<typeof IconButton>['variant'];
      readonly entries: ReadonlyArray<ActivityLogEntry>;
      readonly expanded: boolean;
      readonly isLoading: boolean;
      readonly open: boolean;
      readonly search: string;
      readonly status: 'all' | ActivityLogEntry['status'];
    };
    readonly jobs: {
      readonly buttonBadge: {
        readonly label: string;
        readonly variant: ComponentProps<typeof Badge>['variant'];
      } | null;
      readonly buttonVariant: 'ghost' | 'secondary' | 'warning';
      readonly expanded: boolean;
      readonly isLoading: boolean;
      readonly open: boolean;
      readonly rows: ReadonlyArray<BackgroundJob>;
    };
    readonly lastAction: string;
    readonly projects: ReadonlyArray<ProjectSummary>;
    readonly selectedTreeItemId: string | null;
    readonly tabModels: ReadonlyArray<WorkspaceTabModel>;
    readonly tabsActiveId: string;
    readonly updateNotice: {
      readonly checkedAt?: string | undefined;
      readonly latestVersion?: string | undefined;
      readonly message: string;
      readonly status: 'available' | 'failed';
    } | null;
    readonly onActivityAreaChange: (area: 'all' | ActivityLogEntry['area']) => void;
    readonly onActivityClear: () => void;
    readonly onActivityClose: () => void;
    readonly onActivityExpandedChange: (expanded: boolean) => void;
    readonly onActivityExport: () => void;
    readonly onActivityOpenTarget: (entry: ActivityLogEntry) => void;
    readonly onActivitySearchChange: (search: string) => void;
    readonly onActivityStatusChange: (status: 'all' | ActivityLogEntry['status']) => void;
    readonly onActivityToggle: () => void;
    readonly onJobsCancel: (id: string) => void;
    readonly onJobsClearCompleted: () => void;
    readonly onJobsClose: () => void;
    readonly onJobsExpandedChange: (expanded: boolean) => void;
    readonly onJobsToggle: () => void;
    readonly onCloseAllTabs: () => void;
    readonly onCloseOtherTabs: (tabId: string) => void;
    readonly onCloseTab: (tabId: string) => void;
    readonly onCloseTabsToLeft: (tabId: string) => void;
    readonly onCloseTabsToRight: (tabId: string) => void;
    readonly onDuplicateTab: (tabId: string) => void;
    readonly onConnectionChange: (connectionId: string) => void;
    readonly onRefreshActiveTab: () => void;
    readonly onReorderTabs: (activeId: string, overId: string) => void;
    readonly onSelectTab: (tabId: string) => void;
    readonly onSortByProject: () => void;
    readonly onUpdateDismiss: () => void;
    readonly onUpdateOpenRelease: () => void;
    readonly onUpdateRetry: () => void;
    readonly onViewError: (message: string) => void;
  };
}

export interface AppShellOrchestratorInput {
  readonly activeProject: ProjectSummary | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly activity: AppShellActivityFacade;
  readonly addProjectOpen: boolean;
  readonly appearance: {
    readonly mode: 'dark' | 'light' | 'system';
    readonly resolvedTheme: 'dark' | 'light';
  };
  readonly appVersion: string;
  readonly authTab: AppShellAuthFacade;
  readonly canOpenDataDirectory: boolean;
  readonly closeWorkspaceTabs: (
    state: TabsState,
    input: CloseWorkspaceTabsInput,
  ) => CloseWorkspaceTabsResult;
  readonly credentialWarning: string | null;
  readonly collectionJobRequest: {
    readonly collectionPath: string;
    readonly connectionId: string;
    readonly kind: 'copy' | 'delete' | 'duplicate' | 'export' | 'import';
    readonly requestId: number;
    readonly tabId: string;
  } | null;
  readonly dataMode: 'live' | 'mock';
  readonly demoMode?: boolean | undefined;
  readonly density: DensityName;
  readonly destructiveAction: AppShellDestructiveActionFacade;
  readonly editingProject: ProjectSummary | null;
  readonly firestoreTab: AppShellFirestoreTabFacade;
  readonly firestoreWrite: AppShellFirestoreWriteFacade;
  readonly fdqlTab?: AppShellFdqlFacade | undefined;
  readonly firstRunGuide: AppShellFirstRunGuideFacade;
  readonly focusAuthFilter: () => void;
  readonly focusTreeFilter: () => void;
  readonly jsTab: AppShellJsFacade;
  readonly sqlTab?: AppShellSqlFacade | undefined;
  readonly jobs: AppShellJobsFacade;
  readonly lastAction: string;
  readonly layout: {
    readonly sidebarCollapsed: boolean;
    readonly sidebarDefaultWidth: number;
    readonly onSidebarResize: (size: number) => void;
  };
  readonly nextCreateDocumentRequestId: () => number;
  readonly nextCollectionJobRequestId: () => number;
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly projectsLoading: boolean;
  readonly projectsRepository: ProjectsRepository;
  readonly projectCommands: AppShellProjectCommandFacade;
  readonly jobsRepository: {
    readonly pickExportFile: (
      format: FirestoreExportFormat,
    ) => Promise<{ readonly canceled: boolean; readonly filePath?: string | undefined; }>;
    readonly pickImportFile: () => Promise<{
      readonly canceled: boolean;
      readonly filePath?: string | undefined;
    }>;
  };
  readonly repositories: {
    readonly firestore: {
      readonly listSubcollections: (
        connectionId: string,
        documentPath: string,
      ) => Promise<ReadonlyArray<FirestoreCollectionNode>>;
    };
    readonly settings: SettingsRepository;
  };
  readonly selection: {
    readonly authUserId: string | null;
    readonly treeItemId: string | null;
  };
  readonly settings: AppShellSettingsFacade;
  readonly sidebarCollapsed: boolean;
  readonly tabs: AppShellTabsFacade;
  readonly tabsState: TabsState;
  readonly tree: AppShellTreeFacade;
  readonly updates: AppShellUpdatesFacade;
  readonly ui: AppShellUiActions;
}

export interface AppShellUiActions {
  readonly clearAuthSelection: () => void;
  readonly recordInteraction: (input: {
    readonly activeTabId: string;
    readonly selectedTreeItemId: string | null;
  }) => void;
  readonly requestDestructiveAction: (action: DestructiveAction) => void;
  readonly selectAuthUser: (uid: string | null) => void;
  readonly selectTreeItem: (treeItemId: string | null) => void;
  readonly setAddProjectOpen: (open: boolean) => void;
  readonly setCredentialWarning: (message: string | null) => void;
  readonly setCollectionJobRequest: (
    request: {
      readonly collectionPath: string;
      readonly connectionId: string;
      readonly kind: 'copy' | 'delete' | 'duplicate' | 'export' | 'import';
      readonly requestId: number;
      readonly tabId: string;
    } | null,
  ) => void;
  readonly setEditingProjectId: (id: string | null) => void;
  readonly setLastAction: (message: string) => void;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly setTabInspectorWidth: (tabId: string, width: number) => void;
  readonly setTabsState: (state: TabsState) => void;
  readonly updateActiveTabConnection: (tabId: string, connectionId: string) => void;
}

export interface AppShellDestructiveActionFacade {
  readonly pendingAction: DestructiveAction | null;
  readonly setOpen: (open: boolean) => void;
}

export interface AppShellJobsFacade {
  readonly button: {
    readonly badge: {
      readonly label: string;
      readonly variant: 'danger' | 'neutral' | 'warning';
    } | null;
    readonly variant: 'ghost' | 'secondary' | 'warning';
  };
  readonly cancel: (id: string) => void;
  readonly clearCompleted: () => void;
  readonly close: () => void;
  readonly expanded: boolean;
  readonly isLoading: boolean;
  readonly jobs: ReadonlyArray<BackgroundJob>;
  readonly opened: boolean;
  readonly setExpanded: (expanded: boolean) => void;
  readonly start: (request: FirestoreCollectionJobRequest) => Promise<unknown>;
  readonly toggle: () => void;
}

export interface AppShellProjectCommandFacade {
  readonly addProject: (input: ProjectAddInput) => Promise<ProjectSummary>;
  readonly removeProject: (
    connectionId: string,
    project: ProjectSummary | null,
  ) => Promise<void>;
  readonly updateProject: (
    id: string,
    patch: ProjectUpdatePatch,
  ) => Promise<ProjectSummary>;
}

export interface AppShellTabsFacade {
  readonly goBackInteraction: (
    availableConnectionIds?: ReadonlySet<string>,
    beforeRestore?: (entry: InteractionHistoryEntry) => void,
  ) => InteractionHistoryEntry | null;
  readonly goForwardInteraction: (
    availableConnectionIds?: ReadonlySet<string>,
    beforeRestore?: (entry: InteractionHistoryEntry) => void,
  ) => InteractionHistoryEntry | null;
  readonly openOrSelectTab: (input: OpenTabInput) => string;
  readonly openTab: (input: OpenTabInput) => string;
  readonly duplicateTab: (tabId: string) => string | null;
  readonly reorderTabs: (activeId: string, overId: string) => void;
  readonly selectTab: (tabId: string) => void;
  readonly sortByProject: () => void;
}

export interface AppShellTreeFacade {
  readonly filter: string;
  readonly handleOpenItem: (id: string) => void;
  readonly handleRefreshItem: (id: string) => void;
  readonly handleSelectItem: (id: string) => void;
  readonly handleToggleItem: (id: string) => void;
  readonly items: AccountTreeProps['items'];
  readonly refreshLoadedRoots: () => Promise<void>;
  readonly setFilter: (value: string) => void;
}

export interface AppShellActivityFacade {
  readonly button: {
    readonly badge: AppShellController['workspace']['activity']['buttonBadge'];
    readonly variant: AppShellController['workspace']['activity']['buttonVariant'];
  };
  readonly clear: () => void;
  readonly close: () => void;
  readonly drawer: Omit<
    AppShellController['workspace']['activity'],
    'buttonBadge' | 'buttonVariant'
  >;
  readonly exportEntries: () => void;
  readonly openTargetIntent: (
    entry: ActivityLogEntry,
  ) =>
    | { readonly type: 'firestore'; readonly connectionId: string; readonly path: string; }
    | { readonly type: 'auth'; readonly connectionId: string; readonly uid: string | null; }
    | null;
  readonly setArea: (area: 'all' | ActivityLogEntry['area']) => void;
  readonly setExpanded: (expanded: boolean) => void;
  readonly setSearch: (search: string) => void;
  readonly setStatus: (status: 'all' | ActivityLogEntry['status']) => void;
  readonly toggle: () => void;
}

export interface AppShellUpdatesFacade {
  readonly canCheck: boolean;
  readonly check: (force?: boolean) => void;
  readonly dismiss: () => void;
  readonly isChecking: boolean;
  readonly notice: AppShellController['workspace']['updateNotice'];
  readonly openRelease: () => void;
  readonly statusLabel: string | null;
}

export interface AppShellSettingsFacade {
  readonly changeDensity: (density: DensityName) => void;
  readonly changeTheme: (mode: 'dark' | 'light' | 'system') => void;
  readonly dataDirectoryPath: string | null | undefined;
  readonly open: boolean;
  readonly openDataDirectory: () => Promise<void>;
  readonly openSettings: () => void;
  readonly recordSettingsSaved: (patch: SettingsPatch) => void;
  readonly setOpen: (open: boolean) => void;
}

export interface AppShellFirstRunGuideFacade {
  readonly errorMessage: string | null;
  readonly keepMock: () => void;
  readonly open: boolean;
  readonly openSettings: () => void;
  readonly saving: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly show: () => void;
  readonly switchToLive: () => void;
}

export interface AppShellAuthFacade {
  readonly authFilter: string;
  readonly clear: () => void;
  readonly errorMessage: string | null;
  readonly isTabLoading: (tabId: string) => boolean;
  readonly loadMore: () => void;
  readonly refetch: () => void;
  readonly saveCustomClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
  readonly selectedUser: AuthUser | null;
  readonly setAuthFilter: (value: string) => void;
  readonly users: ReadonlyArray<AuthUser>;
  readonly usersHasMore: boolean;
  readonly usersIsFetchingMore: boolean;
  readonly usersIsLoading: boolean;
}

export interface AppShellJsFacade {
  readonly cancelScript: () => boolean;
  readonly clearTab: (tabId: string) => void;
  readonly clearTabRuntime: (tabId: string) => void;
  readonly duplicateTab: (sourceTabId: string, targetTabId: string) => void;
  readonly isRunning: boolean;
  readonly isTabRunning: (tabId: string) => boolean;
  readonly runScript: () => boolean;
  readonly scriptResult: ScriptRunResult | undefined;
  readonly scriptRunId: string | null;
  readonly scriptSource: string;
  readonly scriptStartedAt: number | null;
  readonly setScriptSource: (source: string) => void;
}

export interface AppShellSqlFacade {
  readonly cancel: () => boolean;
  readonly clearTab: (tabId: string) => void;
  readonly compile: () => boolean;
  readonly compileResult: FirestoreSqlCompileResult | undefined;
  readonly context: FirestoreSqlContext;
  readonly duplicateTab: (sourceTabId: string, targetTabId: string) => void;
  readonly isRunning: boolean;
  readonly isTabRunning: (tabId: string) => boolean;
  readonly result: FirestoreSqlRunResult | undefined;
  readonly run: () => boolean;
  readonly runId: string | null;
  readonly runStartedAt: number | null;
  readonly setContext: (context: FirestoreSqlContext) => void;
  readonly setSource: (source: string) => void;
  readonly source: string;
}

export interface AppShellFdqlFacade {
  readonly cancel: () => boolean;
  readonly clearTab: (tabId: string) => void;
  readonly clearTabRuntime: (tabId: string) => void;
  readonly compileResult: FdqlCompileResult | undefined;
  readonly duplicateTab: (sourceTabId: string, targetTabId: string) => void;
  readonly isRunning: boolean;
  readonly isTabRunning: (tabId: string) => boolean;
  readonly result: FdqlRunResult | undefined;
  readonly run: () => boolean;
  readonly runId: string | null;
  readonly runStartedAt: number | null;
  readonly setSource: (source: string) => void;
  readonly source: string;
}

const emptySqlFacade: AppShellSqlFacade = {
  cancel: () => false,
  clearTab: () => undefined,
  compile: () => false,
  compileResult: undefined,
  context: {},
  duplicateTab: () => undefined,
  isRunning: false,
  isTabRunning: () => false,
  result: undefined,
  run: () => false,
  runId: null,
  runStartedAt: null,
  setContext: () => undefined,
  setSource: () => undefined,
  source: '',
};

const emptyFdqlFacade: AppShellFdqlFacade = {
  cancel: () => false,
  clearTab: () => undefined,
  clearTabRuntime: () => undefined,
  compileResult: undefined,
  duplicateTab: () => undefined,
  isRunning: false,
  isTabRunning: () => false,
  result: undefined,
  run: () => false,
  runId: null,
  runStartedAt: null,
  setSource: () => undefined,
  source: '',
};

export interface AppShellFirestoreTabFacade {
  readonly activeDraft: FirestoreQueryDraft;
  readonly activeQueryConnectionId?: string | null | undefined;
  readonly activeQueryPath: string | null;
  readonly activeResultExecution?: SubmittedFirestoreQuery | null | undefined;
  readonly clearTab: (tabId: string) => void;
  readonly duplicateTab: (sourceTabId: string, targetTabId: string) => void;
  readonly invalidateTab: (tabId: string) => void;
  readonly errorMessage: string | null;
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly isLoading: boolean;
  readonly isTabLoading: (tabId: string) => boolean;
  readonly loadMore: () => void;
  readonly loadSubcollections: (
    documentPath: string,
  ) => Promise<ReadonlyArray<FirestoreCollectionNode>>;
  readonly openTab: (connectionId: string, path: string) => string;
  readonly openTabInNewTab: (connectionId: string, path: string) => string;
  readonly queryRows: ReadonlyArray<FirestoreDocumentResult>;
  readonly refreshQuery: () => string | null;
  readonly activeInspectorUi: FirestoreInspectorUiState;
  readonly resultView: FirestoreResultView;
  readonly resultsStale: boolean;
  readonly runQuery: () => string | null;
  readonly selectDocument: (tabId: string, path: string | null) => void;
  readonly selectedDocument: FirestoreDocumentResult | null;
  readonly selectedDocumentPath: string | null;
  readonly removeResultDocument: (
    execution: SubmittedFirestoreQuery,
    documentPath: string,
  ) => void;
  readonly replaceResultDocument: (
    execution: SubmittedFirestoreQuery,
    document: FirestoreDocumentResult,
  ) => void;
  readonly editDraft: (edit: FirestoreQueryDraftEdit) => void;
  readonly setInspectorOverviewCollapsed: (tabId: string, collapsed: boolean) => void;
  readonly setInspectorSectionOpen: (
    tabId: string,
    section: FirestoreInspectorSectionId,
    open: boolean,
  ) => void;
  readonly setResultTreeExpandedIds: (
    tabId: string,
    expandedIds: ReadonlyArray<string>,
  ) => void;
  readonly setResultView: (tabId: string, resultView: FirestoreResultView) => void;
  readonly setResultsStale: (tabId: string, stale: boolean) => void;
  readonly setSelectionPreviewExpandedPaths: (
    tabId: string,
    documentPath: string,
    expandedPaths: ReadonlyArray<string>,
  ) => void;
}

export interface AppShellFirestoreWriteFacade {
  readonly clearTabScope: (tabId: string) => void;
  readonly createDocument: (
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
  readonly createDocumentRequest: WorkspaceTabViewProps['firestore']['createDocumentRequest'];
  readonly deleteDocument: WorkspaceTabViewProps['firestore']['onDeleteDocument'];
  readonly generateDocumentId: (collectionPath: string) => Promise<string>;
  readonly handleCreateDocumentRequestHandled: (requestId: number) => void;
  readonly requestCreateDocument: (request: {
    readonly collectionPath: string;
    readonly collectionPathEditable?: boolean;
    readonly connectionId: string;
    readonly requestId: number;
    readonly tabId: string;
  }) => void;
  readonly saveDocument: (
    documentPath: string,
    data: Record<string, unknown>,
    options?: FirestoreSaveDocumentOptions,
  ) => Promise<FirestoreSaveDocumentResult>;
  readonly updateDocumentFields: (
    documentPath: string,
    operations: ReadonlyArray<FirestoreFieldPatchOperation>,
    options: FirestoreUpdateDocumentFieldsOptions,
  ) => Promise<FirestoreUpdateDocumentFieldsResult>;
}

export function createAppShellController(
  input: AppShellOrchestratorInput,
): AppShellController {
  const sqlTab = input.sqlTab ?? emptySqlFacade;
  const fdqlTab = input.fdqlTab ?? emptyFdqlFacade;
  const availableConnectionIds = new Set(input.projects.map((project) => project.id));
  const openTabIds = new Set(input.tabsState.tabs.map((tab) => tab.id));
  const activeInteraction = input.tabsState.interactionHistory[
    input.tabsState.interactionHistoryIndex
  ];
  const currentInteractionTab = input.tabsState.tabs.find(
    (tab) => tab.id === input.tabsState.activeTabId,
  );
  const currentInteractionIsDirty = Boolean(
    activeInteraction
      && currentInteractionTab
      && (
        activeInteraction?.activeTabId !== currentInteractionTab.id
        || activeInteraction.selectedTreeItemId !== input.tabsState.selectedTreeItemId
        || JSON.stringify(activeInteraction.location)
          !== JSON.stringify(interactionLocationForTab(currentInteractionTab))
      ),
  );
  const interactionIsAvailable = (entry: InteractionHistoryEntry) =>
    openTabIds.has(entry.activeTabId)
    && availableConnectionIds.has(entry.location.connectionId);
  const canGoBack = currentInteractionIsDirty
    || input.tabsState.interactionHistory
      .slice(0, input.tabsState.interactionHistoryIndex)
      .some(interactionIsAvailable);
  const canGoForward = !currentInteractionIsDirty
    && input.tabsState.interactionHistory
      .slice(input.tabsState.interactionHistoryIndex + 1)
      .some(interactionIsAvailable);
  const tabModels = input.tabsState.tabs.map((tab) => ({
    id: tab.id,
    kind: tab.kind,
    title: tabTitle(tab),
    connectionId: tab.connectionId,
    canGoBack: tab.kind === 'firestore-query'
      ? tab.id === input.tabsState.activeTabId && canGoBack
      : tab.historyIndex > 0,
    canGoForward: tab.kind === 'firestore-query'
      ? tab.id === input.tabsState.activeTabId && canGoForward
      : tab.historyIndex < tab.history.length - 1,
  }));

  function handleBackInteraction() {
    const entry = input.tabs.goBackInteraction(availableConnectionIds, prepareInteractionRestore);
    if (!entry) {
      input.ui.setLastAction('No available previous interaction');
      return;
    }
    restoreInteraction(entry);
  }

  function handleForwardInteraction() {
    const entry = input.tabs.goForwardInteraction(
      availableConnectionIds,
      prepareInteractionRestore,
    );
    if (!entry) {
      input.ui.setLastAction('No available next interaction');
      return;
    }
    restoreInteraction(entry);
  }

  function restoreInteraction(entry: InteractionHistoryEntry) {
    input.ui.selectTreeItem(entry.selectedTreeItemId);
    input.ui.setLastAction('Restored previous interaction');
  }

  function prepareInteractionRestore(entry: InteractionHistoryEntry) {
    const current = input.tabsState.tabs.find((tab) => tab.id === entry.activeTabId);
    if (current?.kind === 'firestore-query' && entry.location.kind === 'firestore-query') {
      if (
        firestoreDraftFingerprint(current.connectionId, current.draft)
          !== firestoreDraftFingerprint(entry.location.connectionId, entry.location.draft)
      ) {
        input.firestoreTab.invalidateTab(current.id);
      }
    } else if (current && current.connectionId !== entry.location.connectionId) {
      clearConnectionScopedTabState(current);
    }
  }

  function handleFocusSearch() {
    if (input.activeTab?.kind === 'auth-users') {
      input.focusAuthFilter();
      return;
    }
    input.focusTreeFilter();
  }

  function requestCloseTab(tabId: string) {
    const tab = input.tabsState.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const title = tabTitle(tab);
    const isLastTab = input.tabsState.tabs.length === 1;
    input.ui.requestDestructiveAction({
      confirmLabel: 'Close',
      description: isLastTab
        ? `Close ${title}? The workspace will have no open tabs.`
        : `Close ${title}? Unsaved tab state for this tab will be discarded.`,
      onConfirm: () => {
        closeTabsWithCleanup([tab], `Closed ${title}`);
      },
      title: 'Close tab',
    });
  }

  function duplicateTab(tabId: string) {
    const tab = input.tabsState.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTabId = input.tabs.duplicateTab(tab.id);
    if (!nextTabId) return;
    duplicateTabState(tab, nextTabId);
    const selectedTreeItemId = treeItemIdForTab({ ...tab, id: nextTabId });
    input.ui.selectTreeItem(selectedTreeItemId);
    input.ui.recordInteraction({
      activeTabId: nextTabId,
      selectedTreeItemId,
    });
    input.ui.setLastAction(`Duplicated ${tabTitle(tab)}`);
  }

  function requestCloseOtherTabs(tabId: string) {
    const tab = input.tabsState.tabs.find((item) => item.id === tabId);
    const count = input.tabsState.tabs.length - 1;
    if (!tab || count <= 0) return;
    input.ui.requestDestructiveAction({
      confirmLabel: 'Close others',
      description: `Close ${count} other tab${
        count === 1 ? '' : 's'
      }? Their tab state will be discarded.`,
      onConfirm: () => {
        const tabsToClose = input.tabsState.tabs.filter((item) => item.id !== tabId);
        closeTabsWithCleanup(tabsToClose, `Closed other tabs around ${tabTitle(tab)}`);
      },
      title: 'Close other tabs',
    });
  }

  function requestCloseTabsToLeft(tabId: string) {
    const index = input.tabsState.tabs.findIndex((tab) => tab.id === tabId);
    if (index <= 0) return;
    input.ui.requestDestructiveAction({
      confirmLabel: 'Close tabs',
      description: `Close ${index} tab${
        index === 1 ? '' : 's'
      } to the left? Their tab state will be discarded.`,
      onConfirm: () => {
        closeTabsWithCleanup(input.tabsState.tabs.slice(0, index), 'Closed tabs to left');
      },
      title: 'Close tabs to left',
    });
  }

  function requestCloseTabsToRight(tabId: string) {
    const index = input.tabsState.tabs.findIndex((tab) => tab.id === tabId);
    const count = index < 0 ? 0 : input.tabsState.tabs.length - index - 1;
    if (count <= 0) return;
    input.ui.requestDestructiveAction({
      confirmLabel: 'Close tabs',
      description: `Close ${count} tab${
        count === 1 ? '' : 's'
      } to the right? Their tab state will be discarded.`,
      onConfirm: () => {
        closeTabsWithCleanup(input.tabsState.tabs.slice(index + 1), 'Closed tabs to right');
      },
      title: 'Close tabs to right',
    });
  }

  function requestCloseAllTabs() {
    if (!input.tabsState.tabs.length) return;
    input.ui.requestDestructiveAction({
      confirmLabel: 'Close all',
      description: `Close all ${input.tabsState.tabs.length} open tab${
        input.tabsState.tabs.length === 1 ? '' : 's'
      }? The workspace will have no open tabs.`,
      onConfirm: () => closeTabsWithCleanup(input.tabsState.tabs, 'Closed all tabs'),
      title: 'Close all tabs',
    });
  }

  function handleRemoveTreeItem(id: string) {
    const parsed = parseTreeId(id);
    if (parsed.kind !== 'project' || !parsed.connectionId) return;
    const connectionId = parsed.connectionId;
    const project = input.projects.find((item) => item.id === connectionId) ?? null;
    input.ui.requestDestructiveAction({
      confirmLabel: 'Remove',
      description: `Remove ${project?.name ?? 'this project'} from the workspace tree?`,
      onConfirm: () => {
        void input.projectCommands.removeProject(connectionId, project)
          .catch((error) => {
            input.ui.setLastAction(
              `Remove failed: ${messageFromError(error, 'Could not remove project.')}`,
            );
          });
      },
      title: 'Remove project',
    });
  }

  function handleEditTreeItem(id: string) {
    const parsed = parseTreeId(id);
    if (parsed.kind !== 'project' || !parsed.connectionId) return;
    input.ui.setEditingProjectId(parsed.connectionId);
  }

  function handleCreateDocumentFromTree(id: string) {
    const parsed = parseTreeId(id);
    if (parsed.kind !== 'collection' || !parsed.connectionId || !parsed.path) return;
    const tabId = openFirestoreTab(parsed.connectionId, parsed.path);
    input.firestoreWrite.requestCreateDocument({
      collectionPath: parsed.path,
      connectionId: parsed.connectionId,
      requestId: input.nextCreateDocumentRequestId(),
      tabId,
    });
    input.ui.recordInteraction({
      activeTabId: tabId,
      selectedTreeItemId: id,
    });
    input.ui.setLastAction(`Creating document in ${parsed.path}`);
  }

  function handleCollectionJobFromTree(
    id: string,
    kind: 'copy' | 'delete' | 'duplicate' | 'export' | 'import',
  ) {
    const parsed = parseTreeId(id);
    if (parsed.kind !== 'collection' || !parsed.connectionId || !parsed.path) return;
    const tabId = input.firestoreTab.openTab(parsed.connectionId, parsed.path);
    input.ui.recordInteraction({
      activeTabId: tabId,
      selectedTreeItemId: id,
    });
    input.ui.setCollectionJobRequest({
      collectionPath: parsed.path,
      connectionId: parsed.connectionId,
      kind,
      requestId: input.nextCollectionJobRequestId(),
      tabId,
    });
    input.ui.setLastAction(`Opened ${kind} collection job`);
  }

  function handleCreateCollectionFromTree(id: string) {
    const parsed = parseTreeId(id);
    if (parsed.kind !== 'firestore' || !parsed.connectionId) return;
    const tabId = openFirestoreTab(parsed.connectionId, '');
    input.firestoreWrite.requestCreateDocument({
      collectionPath: '',
      collectionPathEditable: true,
      connectionId: parsed.connectionId,
      requestId: input.nextCreateDocumentRequestId(),
      tabId,
    });
    input.ui.recordInteraction({
      activeTabId: tabId,
      selectedTreeItemId: id,
    });
    input.ui.setLastAction('Creating collection');
  }

  function handleRunQuery() {
    const path = input.firestoreTab.runQuery();
    if (path) input.ui.setLastAction(`Ran query ${path}`);
  }

  function handleRefreshResults() {
    const path = input.firestoreTab.refreshQuery();
    if (path) input.ui.setLastAction(`Refreshed results ${path}`);
  }

  function handleResultsStaleChange(stale: boolean, scopeKey?: string) {
    const tabId = scopeKey
      ?? (input.activeTab?.kind === 'firestore-query' ? input.activeTab.id : null);
    if (!tabId) return;
    input.firestoreTab.setResultsStale(tabId, stale);
  }

  function handleResultViewChange(resultView: FirestoreResultView, scopeKey?: string) {
    const tabId = scopeKey
      ?? (input.activeTab?.kind === 'firestore-query' ? input.activeTab.id : null);
    if (!tabId) return;
    input.firestoreTab.setResultView(tabId, resultView);
  }

  function handleLoadMoreFirestore() {
    input.firestoreTab.loadMore();
    input.ui.setLastAction(`Requested more results from ${input.firestoreTab.activeDraft.path}`);
  }

  function handleRunScript() {
    if (input.jsTab.isRunning) {
      handleCancelScript();
      return;
    }
    if (input.jsTab.runScript()) input.ui.setLastAction('Ran JavaScript query');
  }

  function handleCancelScript() {
    if (input.jsTab.cancelScript()) input.ui.setLastAction('Cancelled JavaScript query');
  }

  function handleCompileSql() {
    if (sqlTab.compile()) input.ui.setLastAction('Prepared Firestore SQL');
  }

  function handleRunSql() {
    if (sqlTab.isRunning) {
      handleCancelSql();
      return;
    }
    if (sqlTab.run()) input.ui.setLastAction('Ran Firestore SQL');
  }

  function handleCancelSql() {
    if (sqlTab.cancel()) input.ui.setLastAction('Cancelled Firestore SQL');
  }

  function handleRunFdql() {
    if (fdqlTab.isRunning) {
      handleCancelFdql();
      return;
    }
    if (fdqlTab.run()) input.ui.setLastAction('Ran FDQL');
  }

  function handleCancelFdql() {
    if (fdqlTab.cancel()) input.ui.setLastAction('Cancelled FDQL');
  }

  function openTab(kind: WorkspaceTabKind) {
    if (!input.activeTab || !input.activeProject) {
      input.ui.setLastAction('Choose a connection item first');
      return null;
    }
    if (kind === 'firestore-query') {
      const path = input.activeTab.kind === 'firestore-query'
        ? input.activeTab.draft.path
        : DEFAULT_FIRESTORE_DRAFT.path;
      return input.firestoreTab.openTabInNewTab(input.activeTab.connectionId, path);
    }
    return input.tabs.openTab({ kind, connectionId: input.activeTab.connectionId });
  }

  function openToolTab(kind: Exclude<WorkspaceTabKind, 'firestore-query'>, connectionId: string) {
    return input.tabs.openOrSelectTab({ kind, connectionId });
  }

  function openFirestoreTab(connectionId: string, path: string) {
    return input.firestoreTab.openTab(connectionId, path);
  }

  function handleSelectTab(tabId: string) {
    input.tabs.selectTab(tabId);
    const tab = input.tabsState.tabs.find((item) => item.id === tabId);
    const selectedTreeItemId = tab ? treeItemIdForTab(tab) : input.selection.treeItemId;
    input.ui.selectTreeItem(selectedTreeItemId);
    input.ui.recordInteraction({
      activeTabId: tabId,
      selectedTreeItemId,
    });
    input.ui.setLastAction(`Switched to ${tab ? tabTitle(tab) : 'tab'}`);
  }

  function handleActiveProjectChange(connectionId: string) {
    if (!input.activeTab) return;
    if (input.activeTab.connectionId === connectionId) return;
    clearConnectionScopedTabState(input.activeTab);
    input.ui.updateActiveTabConnection(input.activeTab.id, connectionId);
    const nextTreeItemId = treeItemIdForTab({ ...input.activeTab, connectionId });
    input.ui.selectTreeItem(nextTreeItemId);
    input.ui.recordInteraction({
      activeTabId: input.activeTab.id,
      selectedTreeItemId: nextTreeItemId,
    });
    input.ui.setLastAction('Changed tab account');
  }

  function clearConnectionScopedTabState(tab: WorkspaceTab) {
    if (input.collectionJobRequest?.tabId === tab.id) {
      input.ui.setCollectionJobRequest(null);
    }
    if (tab.kind === 'firestore-query') {
      clearTabRuntimeState(tab);
      input.firestoreWrite.clearTabScope(tab.id);
    } else if (tab.kind === 'js-query') input.jsTab.clearTabRuntime(tab.id);
    else if (tab.kind === 'firestore-sql') sqlTab.clearTab(tab.id);
    else if (tab.kind === 'fdql') fdqlTab.clearTabRuntime(tab.id);
    else {
      input.ui.clearAuthSelection();
      input.authTab.clear();
    }
  }

  function duplicateTabState(sourceTab: WorkspaceTab, targetTabId: string) {
    if (sourceTab.kind === 'firestore-query') {
      input.firestoreTab.duplicateTab(sourceTab.id, targetTabId);
    } else if (sourceTab.kind === 'js-query') {
      input.jsTab.duplicateTab(sourceTab.id, targetTabId);
    } else if (sourceTab.kind === 'firestore-sql') {
      sqlTab.duplicateTab(sourceTab.id, targetTabId);
    } else if (sourceTab.kind === 'fdql') {
      fdqlTab.duplicateTab(sourceTab.id, targetTabId);
    }
  }

  function closeTabsWithCleanup(tabsToClose: ReadonlyArray<WorkspaceTab>, successLabel: string) {
    const busyTabIds = new Set(
      tabsToClose.filter((tab) => tab.kind !== 'js-query' && isTabBusy(tab)).map((tab) => tab.id),
    );
    const result = input.closeWorkspaceTabs(input.tabsState, {
      busyTabIds,
      successLabel,
      tabsToClose,
    });
    for (const tab of result.tabsToCleanup) clearClosedTabRuntimeState(tab);
    input.ui.setTabsState(result.state);
    input.ui.setLastAction(result.lastAction);
  }

  function clearTabRuntimeState(tab: WorkspaceTab) {
    input.firestoreTab.invalidateTab(tab.id);
  }

  function clearClosedTabRuntimeState(tab: WorkspaceTab) {
    if (input.collectionJobRequest?.tabId === tab.id) {
      input.ui.setCollectionJobRequest(null);
    }
    input.firestoreTab.clearTab(tab.id);
    input.firestoreWrite.clearTabScope(tab.id);
    input.jsTab.clearTab(tab.id);
    sqlTab.clearTab(tab.id);
    fdqlTab.clearTab(tab.id);
  }

  function isTabBusy(tab: WorkspaceTab): boolean {
    if (tab.kind === 'js-query') return input.jsTab.isTabRunning(tab.id);
    if (tab.kind === 'firestore-sql') return sqlTab.isTabRunning(tab.id);
    if (tab.kind === 'fdql') return fdqlTab.isTabRunning(tab.id);
    if (tab.kind === 'firestore-query') return input.firestoreTab.isTabLoading(tab.id);
    if (tab.kind === 'auth-users') return input.authTab.isTabLoading(tab.id);
    return false;
  }

  function handleRefreshActiveTab() {
    if (!input.activeTab) return;
    if (input.activeTab.kind === 'firestore-query') handleRunQuery();
    if (input.activeTab.kind === 'auth-users') input.authTab.refetch();
    if (input.activeTab.kind === 'js-query') handleRunScript();
    if (input.activeTab.kind === 'fdql') handleRunFdql();
    if (input.activeTab.kind === 'firestore-sql') handleRunSql();
    input.ui.setLastAction(`Refreshed ${tabTitle(input.activeTab)}`);
  }

  async function handleLoadSubcollections(
    documentPath: string,
  ): Promise<ReadonlyArray<FirestoreCollectionNode>> {
    return await input.firestoreTab.loadSubcollections(documentPath);
  }

  function handleOpenActivityTarget(entry: ActivityLogEntry) {
    const intent = input.activity.openTargetIntent(entry);
    if (!intent) return;
    if (intent.type === 'firestore') {
      const tabId = openFirestoreTab(intent.connectionId, intent.path);
      input.ui.recordInteraction({
        activeTabId: tabId,
        selectedTreeItemId: firestoreTargetTreeItemId(intent.connectionId, intent.path),
      });
      input.ui.setLastAction(`Opened ${intent.path}`);
      return;
    }
    const tabId = openToolTab('auth-users', intent.connectionId);
    input.ui.selectAuthUser(intent.uid);
    input.ui.recordInteraction({
      activeTabId: tabId,
      selectedTreeItemId: authNodeId(intent.connectionId),
    });
    input.ui.setLastAction(intent.uid ? `Opened ${intent.uid}` : 'Opened Authentication');
  }

  const activeTabIsRefreshing = input.activeTab
    ? input.activeTab.kind === 'firestore-query'
      ? input.firestoreTab.isLoading
      : input.activeTab.kind === 'auth-users'
      ? input.authTab.usersIsLoading
      : input.activeTab.kind === 'js-query'
      ? input.jsTab.isRunning
      : input.activeTab.kind === 'firestore-sql'
      ? sqlTab.isRunning
      : input.activeTab.kind === 'fdql'
      ? fdqlTab.isRunning
      : false
    : false;
  const scopedCollectionJobRequest = input.activeTab?.kind === 'firestore-query'
      && input.collectionJobRequest?.tabId === input.activeTab.id
      && input.collectionJobRequest.connectionId === input.activeTab.connectionId
    ? input.collectionJobRequest
    : null;

  const tabView: WorkspaceTabViewProps | null = input.activeTab
    ? {
      activeTab: input.activeTab,
      density: input.density,
      auth: {
        errorMessage: input.authTab.errorMessage,
        filter: input.authTab.authFilter,
        hasMore: input.authTab.usersHasMore,
        isFetchingMore: input.authTab.usersIsFetchingMore,
        isLoading: input.authTab.usersIsLoading,
        onFilterChange: input.authTab.setAuthFilter,
        onLoadMore: input.authTab.loadMore,
        onSaveCustomClaims: input.authTab.saveCustomClaims,
        onSelectUser: input.ui.selectAuthUser,
        selectedUser: input.authTab.selectedUser,
        selectedUserId: input.selection.authUserId,
        users: input.authTab.users,
      },
      firestore: {
        activeProject: input.activeProject,
        collectionJobRequest: scopedCollectionJobRequest,
        createDocumentRequest: input.firestoreWrite.createDocumentRequest,
        draft: input.firestoreTab.activeDraft,
        errorMessage: input.firestoreTab.errorMessage,
        hasMore: input.firestoreTab.hasMore,
        inspectorUi: input.firestoreTab.activeInspectorUi,
        inspectorWidth: input.activeTab?.inspectorWidth ?? 360,
        isFetchingMore: input.firestoreTab.isFetchingMore,
        isLoading: input.firestoreTab.isLoading,
        onCreateDocument: input.firestoreWrite.createDocument,
        onCollectionJobRequestHandled: (requestId) => {
          if (scopedCollectionJobRequest?.requestId === requestId) {
            input.ui.setCollectionJobRequest(null);
          }
        },
        onCreateDocumentRequestHandled: input.firestoreWrite.handleCreateDocumentRequestHandled,
        onDeleteDocument: input.firestoreWrite.deleteDocument,
        onDraftEdit: input.firestoreTab.editDraft,
        onGenerateDocumentId: input.firestoreWrite.generateDocumentId,
        onPickCollectionJobExportFile: async (format: FirestoreExportFormat) => {
          const result = await input.jobsRepository.pickExportFile(format);
          return result.canceled ? null : result.filePath ?? null;
        },
        onPickCollectionJobImportFile: async () => {
          const result = await input.jobsRepository.pickImportFile();
          return result.canceled ? null : result.filePath ?? null;
        },
        onLoadMore: handleLoadMoreFirestore,
        onLoadSubcollections: handleLoadSubcollections,
        onOpenDocumentInNewTab: (path) => {
          const connectionId = input.firestoreTab.activeQueryConnectionId
            ?? input.activeTab!.connectionId;
          const tabId = input.firestoreTab.openTabInNewTab(connectionId, path);
          input.ui.recordInteraction({
            activeTabId: tabId,
            selectedTreeItemId: firestoreTargetTreeItemId(connectionId, path),
          });
          input.ui.setLastAction(`Opened ${path} in new tab`);
        },
        onRefreshResults: handleRefreshResults,
        onInspectorOverviewCollapsedChange: (collapsed) => {
          if (input.activeTab) {
            input.firestoreTab.setInspectorOverviewCollapsed(input.activeTab.id, collapsed);
          }
        },
        onInspectorSectionOpenChange: (section, open) => {
          if (input.activeTab) {
            input.firestoreTab.setInspectorSectionOpen(input.activeTab.id, section, open);
          }
        },
        onInspectorWidthChange: (width) => {
          if (input.activeTab) input.ui.setTabInspectorWidth(input.activeTab.id, width);
        },
        onResultViewChange: handleResultViewChange,
        onResultTreeExpandedIdsChange: (expandedIds) => {
          if (input.activeTab) {
            input.firestoreTab.setResultTreeExpandedIds(input.activeTab.id, expandedIds);
          }
        },
        onResultsStaleChange: handleResultsStaleChange,
        onResultDocumentDeleted: (documentPath) => {
          if (input.firestoreTab.activeResultExecution) {
            input.firestoreTab.removeResultDocument(
              input.firestoreTab.activeResultExecution,
              documentPath,
            );
          }
        },
        onResultDocumentSaved: (document) => {
          if (input.firestoreTab.activeResultExecution) {
            input.firestoreTab.replaceResultDocument(
              input.firestoreTab.activeResultExecution,
              document,
            );
          }
        },
        onRunQuery: handleRunQuery,
        onSaveDocument: input.firestoreWrite.saveDocument,
        onSelectDocument: (path) => input.firestoreTab.selectDocument(input.activeTab!.id, path),
        onSelectionPreviewExpandedPathsChange: (documentPath, expandedPaths) => {
          if (input.activeTab) {
            input.firestoreTab.setSelectionPreviewExpandedPaths(
              input.activeTab.id,
              documentPath,
              expandedPaths,
            );
          }
        },
        onStartCollectionJob: async (request) => {
          await input.jobs.start(request);
          if (!input.jobs.opened) input.jobs.toggle();
        },
        onUpdateDocumentFields: input.firestoreWrite.updateDocumentFields,
        projects: input.projects,
        rows: input.firestoreTab.queryRows,
        resultView: input.firestoreTab.resultView,
        resultQueryPath: input.firestoreTab.activeQueryPath,
        resultsStale: input.firestoreTab.resultsStale,
        selectedDocument: input.firestoreTab.selectedDocument,
        selectedDocumentPath: input.firestoreTab.selectedDocumentPath,
        settings: input.repositories.settings,
      },
      script: {
        isRunning: input.jsTab.isRunning,
        onCancel: handleCancelScript,
        onRun: handleRunScript,
        onSourceChange: input.jsTab.setScriptSource,
        result: input.jsTab.scriptResult,
        runId: input.jsTab.scriptRunId,
        runStartedAt: input.jsTab.scriptStartedAt,
        settings: input.repositories.settings,
        source: input.jsTab.scriptSource,
      },
      fdql: {
        compileResult: fdqlTab.compileResult,
        isRunning: fdqlTab.isRunning,
        onCancel: handleCancelFdql,
        onRun: handleRunFdql,
        onSourceChange: fdqlTab.setSource,
        result: fdqlTab.result,
        runId: fdqlTab.runId,
        runStartedAt: fdqlTab.runStartedAt,
        source: fdqlTab.source,
      },
      sql: {
        compileResult: sqlTab.compileResult,
        context: sqlTab.context,
        isRunning: sqlTab.isRunning,
        onCancel: handleCancelSql,
        onCompile: handleCompileSql,
        onRun: handleRunSql,
        onSourceChange: sqlTab.setSource,
        result: sqlTab.result,
        runId: sqlTab.runId,
        runStartedAt: sqlTab.runStartedAt,
        onContextChange: sqlTab.setContext,
        source: sqlTab.source,
      },
    }
    : null;

  const commands = createCommandPaletteModel({
    onChangeTheme: input.settings.changeTheme,
    onFocusTreeFilter: handleFocusSearch,
    onOpenSettings: input.settings.openSettings,
    onOpenTab: openTab,
    onRunQuery: handleRunQuery,
    onRunScript: handleRunScript,
    onRunFdql: handleRunFdql,
    onRunSql: handleRunSql,
    onSelectTab: input.tabs.selectTab,
    resolvedTheme: input.appearance.resolvedTheme,
    tabs: input.tabsState.tabs,
  });

  return {
    commands,
    dialogs: {
      addProjectOpen: input.addProjectOpen,
      appVersion: input.appVersion,
      canOpenDataDirectory: input.canOpenDataDirectory,
      credentialWarning: input.credentialWarning,
      dataDirectoryPath: input.settings.dataDirectoryPath,
      density: input.density,
      destructiveAction: input.destructiveAction.pendingAction,
      editingProject: input.editingProject,
      firstRunGuideError: input.firstRunGuide.errorMessage,
      firstRunGuideOpen: input.firstRunGuide.open,
      firstRunGuideSaving: input.firstRunGuide.saving,
      projectsRepository: input.projectsRepository,
      settingsOpen: input.settings.open,
      ...(input.demoMode
        ? {
          dataModeHelpText: 'The browser demo always uses local sample data.',
          dataModeOptions: ['mock'] as const,
        }
        : {}),
      onAddProjectOpenChange: input.ui.setAddProjectOpen,
      onCredentialWarningDismiss: () => input.ui.setCredentialWarning(null),
      onDensityChange: input.settings.changeDensity,
      onDestructiveActionOpenChange: input.destructiveAction.setOpen,
      onEditProjectOpenChange: (open) => {
        if (!open) input.ui.setEditingProjectId(null);
      },
      onFirstRunGuideKeepMock: input.firstRunGuide.keepMock,
      onFirstRunGuideOpenChange: input.firstRunGuide.setOpen,
      onFirstRunGuideOpenSettings: input.firstRunGuide.openSettings,
      onFirstRunGuideSwitchToLive: input.firstRunGuide.switchToLive,
      onOpenDataDirectory: input.settings.openDataDirectory,
      onProjectAdded: (project) => {
        if (project.hasCredential && project.credentialEncrypted === false) {
          input.ui.setCredentialWarning(
            `Credentials for ${project.name} are stored without OS encryption on this machine.`,
          );
        }
      },
      onProjectAddSubmit: input.projectCommands.addProject,
      onProjectUpdateSubmit: input.projectCommands.updateProject,
      onSettingsOpenChange: input.settings.setOpen,
      onSettingsSaved: input.settings.recordSettingsSaved,
    },
    header: {
      appVersion: input.appVersion,
      canGoBack,
      canGoForward,
      canAddProject: !input.demoMode && !input.projectsLoading,
      canCheckForUpdates: input.updates.canCheck,
      checkingForUpdates: input.updates.isChecking,
      dataMode: input.dataMode,
      demoMode: Boolean(input.demoMode),
      mode: input.appearance.mode,
      resolvedTheme: input.appearance.resolvedTheme,
      updateStatusLabel: input.updates.statusLabel,
      onAddProject: () => input.ui.setAddProjectOpen(true),
      onBack: handleBackInteraction,
      onCheckForUpdates: () => input.updates.check(true),
      onForward: handleForwardInteraction,
      onOpenMockGuide: input.firstRunGuide.show,
      onModeChange: input.settings.changeTheme,
      onOpenSettings: input.settings.openSettings,
    },
    hotkeys: {
      activeTabKind: input.activeTab?.kind ?? null,
      onBack: handleBackInteraction,
      onCloseTab: () => {
        if (input.activeTab) requestCloseTab(input.activeTab.id);
      },
      onFocusSearch: handleFocusSearch,
      onForward: handleForwardInteraction,
      onNewTab: () => openTab(input.activeTab?.kind ?? 'firestore-query'),
      onOpenSettings: input.settings.openSettings,
      onRunQuery: handleRunQuery,
      onRunScript: handleRunScript,
      onRunFdql: handleRunFdql,
    },
    layout: {
      sidebarCollapsed: input.sidebarCollapsed,
      sidebarDefaultWidth: input.layout.sidebarDefaultWidth,
      sidebarMaxSize: input.sidebarCollapsed ? `${COLLAPSED_SIDEBAR_WIDTH}px` : undefined,
      sidebarMinSize: input.sidebarCollapsed
        ? `${COLLAPSED_SIDEBAR_WIDTH}px`
        : `${MIN_SIDEBAR_WIDTH}px`,
      onSidebarResize: input.layout.onSidebarResize,
    },
    sidebar: {
      collapsed: input.sidebarCollapsed,
      density: input.density,
      filterValue: input.tree.filter,
      items: input.tree.items,
      ...(input.demoMode || input.projectsLoading
        ? {}
        : { onAddProject: () => input.ui.setAddProjectOpen(true) }),
      onCollapse: () => input.ui.setSidebarCollapsed(true),
      onCreateCollection: handleCreateCollectionFromTree,
      onCreateDocument: handleCreateDocumentFromTree,
      onCollectionJob: handleCollectionJobFromTree,
      onEditItem: input.demoMode ? undefined : handleEditTreeItem,
      onExpand: () => input.ui.setSidebarCollapsed(false),
      onFilterChange: input.tree.setFilter,
      onOpenItem: input.tree.handleOpenItem,
      onRefreshItem: input.tree.handleRefreshItem,
      onRemoveItem: handleRemoveTreeItem,
      onSelectItem: input.tree.handleSelectItem,
      onToggleItem: input.tree.handleToggleItem,
    },
    tabView,
    workspace: {
      activeProject: input.activeProject,
      activeTab: input.activeTab,
      activeTabIsRefreshing,
      activity: {
        area: input.activity.drawer.area,
        buttonBadge: input.activity.button.badge,
        buttonVariant: input.activity.button.variant,
        entries: input.activity.drawer.entries,
        expanded: input.activity.drawer.expanded,
        isLoading: input.activity.drawer.isLoading,
        open: input.activity.drawer.open,
        search: input.activity.drawer.search,
        status: input.activity.drawer.status,
      },
      jobs: {
        buttonBadge: input.jobs.button.badge,
        buttonVariant: input.jobs.button.variant,
        expanded: input.jobs.expanded,
        isLoading: input.jobs.isLoading,
        open: input.jobs.opened,
        rows: input.jobs.jobs,
      },
      lastAction: input.lastAction,
      projects: input.projects,
      selectedTreeItemId: input.selection.treeItemId,
      tabModels,
      tabsActiveId: input.tabsState.activeTabId,
      updateNotice: input.updates.notice,
      onActivityAreaChange: input.activity.setArea,
      onActivityClear: () => {
        input.ui.requestDestructiveAction({
          confirmLabel: 'Clear',
          description: 'Clear local Activity entries?',
          onConfirm: input.activity.clear,
          title: 'Clear activity',
        });
      },
      onActivityClose: input.activity.close,
      onActivityExpandedChange: input.activity.setExpanded,
      onActivityExport: input.activity.exportEntries,
      onActivityOpenTarget: handleOpenActivityTarget,
      onActivitySearchChange: input.activity.setSearch,
      onActivityStatusChange: input.activity.setStatus,
      onActivityToggle: input.activity.toggle,
      onJobsCancel: input.jobs.cancel,
      onJobsClearCompleted: input.jobs.clearCompleted,
      onJobsClose: input.jobs.close,
      onJobsExpandedChange: input.jobs.setExpanded,
      onJobsToggle: input.jobs.toggle,
      onCloseAllTabs: requestCloseAllTabs,
      onCloseOtherTabs: requestCloseOtherTabs,
      onCloseTab: requestCloseTab,
      onCloseTabsToLeft: requestCloseTabsToLeft,
      onCloseTabsToRight: requestCloseTabsToRight,
      onDuplicateTab: duplicateTab,
      onConnectionChange: handleActiveProjectChange,
      onRefreshActiveTab: handleRefreshActiveTab,
      onReorderTabs: input.tabs.reorderTabs,
      onSelectTab: handleSelectTab,
      onSortByProject: input.tabs.sortByProject,
      onUpdateDismiss: input.updates.dismiss,
      onUpdateOpenRelease: input.updates.openRelease,
      onUpdateRetry: () => input.updates.check(true),
      onViewError: (message) => input.ui.setLastAction(`View failed: ${message}`),
    },
  };
}

export interface CloseWorkspaceTabsResult {
  readonly lastAction: string;
  readonly state: TabsState;
  readonly tabsToCleanup: ReadonlyArray<WorkspaceTab>;
}

export interface CloseWorkspaceTabsInput {
  readonly busyTabIds: ReadonlySet<string>;
  readonly successLabel: string;
  readonly tabsToClose: ReadonlyArray<WorkspaceTab>;
}

function firestoreTargetTreeItemId(connectionId: string, path: string): string {
  const collectionPath = firestoreCollectionPathForTarget(path);
  return collectionPath
    ? collectionNodeId(connectionId, collectionPath)
    : firestoreNodeId(connectionId);
}

function messageFromError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}
