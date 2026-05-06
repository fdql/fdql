import { defaultDensity, type DensityName } from '@firebase-desk/design-tokens';
import { useAppearance } from '@firebase-desk/product-ui';
import { useSelector } from '@tanstack/react-store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityStore } from '../../app-core/activity/activityStore.ts';
import { useActivityController } from '../../app-core/activity/useActivityController.ts';
import { useFirestoreWriteController } from '../../app-core/firestore/write/useFirestoreWriteController.ts';
import { useJobsController } from '../../app-core/jobs/useJobsController.ts';
import { useSettingsController } from '../../app-core/settings/useSettingsController.ts';
import { useUpdateController } from '../../app-core/updates/useUpdateController.ts';
import { closeWorkspaceTabsCommand } from '../../app-core/workspace/workspaceCommands.ts';
import { type AppShellController, createAppShellController } from '../appShellOrchestrator.ts';
import { type RepositorySet, useRepositories } from '../RepositoryProvider.tsx';
import { selectionActions, selectionStore } from '../stores/selectionStore.ts';
import { tabActions, tabsStore, type WorkspaceTabKind } from '../stores/tabsStore.ts';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, resolveProject } from '../workspaceModel.ts';
import type { WorkspacePersistenceFailure } from '../workspacePersistence.ts';
import { useAppShellHotkeys } from './useAppShellHotkeys.ts';
import { useAuthTabState } from './useAuthTabState.ts';
import { useDestructiveActionController } from './useDestructiveActionController.ts';
import { useDocumentDensity } from './useDocumentDensity.ts';
import { useFdqlTabState } from './useFdqlTabState.ts';
import { useFirestoreSqlTabState } from './useFirestoreSqlTabState.ts';
import { useFirestoreTabState } from './useFirestoreTabState.ts';
import { useJsTabState } from './useJsTabState.ts';
import {
  usePersistedWorkspaceState,
  usePersistWorkspaceSnapshot,
} from './usePersistedWorkspaceState.ts';
import { useProjectCommandController } from './useProjectCommandController.ts';
import { useProjects } from './useProjects.ts';
import { useWorkspaceTree } from './useWorkspaceTree.ts';

export interface UseAppShellControllerInput {
  readonly appVersion: string;
  readonly activityStore?: ActivityStore | undefined;
  readonly dataMode?: 'live' | 'mock';
  readonly demoMode?: boolean | undefined;
  readonly initialSidebarWidth?: number;
}

export function useAppShellController(
  {
    activityStore,
    appVersion,
    dataMode = 'mock',
    demoMode = false,
    initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  }: UseAppShellControllerInput,
): AppShellController {
  const appearance = useAppearance();
  const repositories = useRepositories();
  const desktopAppApi = getDesktopAppApi();
  const tabsState = useSelector(tabsStore, (state) => state);
  const selection = useSelector(selectionStore, (state) => state);
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeTabId)
    ?? tabsState.tabs[0];
  const activeProject = activeTab ? resolveProject(projects, activeTab.connectionId) : null;

  const [density, setDensity] = useState<DensityName>(defaultDensity);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [firstRunGuideOpen, setFirstRunGuideOpen] = useState(false);
  const [firstRunGuideSaving, setFirstRunGuideSaving] = useState(false);
  const [firstRunGuideError, setFirstRunGuideError] = useState<string | null>(null);
  const [credentialWarning, setCredentialWarning] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState('Ready');
  const [workspacePersistenceError, setWorkspacePersistenceError] = useState<
    WorkspacePersistenceFailure | null
  >(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const destructiveAction = useDestructiveActionController();
  const nextCreateDocumentRequestId = useRef(1);
  const nextCollectionJobRequestId = useRef(1);
  const [collectionJobRequest, setCollectionJobRequest] = useState<
    {
      readonly collectionPath: string;
      readonly kind: 'copy' | 'delete' | 'duplicate' | 'export' | 'import';
      readonly requestId: number;
    } | null
  >(null);

  const activity = useActivityController({
    loadIssuePreviewOnMount: !activityStore,
    onStatus: setLastAction,
    repository: repositories.activity,
    store: activityStore,
  });
  const recordActivity = activity.record;
  const jobs = useJobsController({
    onStatus: setLastAction,
    repository: repositories.jobs,
  });
  const persistedWorkspace = usePersistedWorkspaceState({
    onError: setWorkspacePersistenceError,
    settings: repositories.settings,
  });
  const settings = useSettingsController({
    dataDirectoryApi: desktopAppApi,
    onStatus: setLastAction,
    recordActivity,
    repository: repositories.settings,
    setAppearanceMode: appearance.setMode,
    setDensity,
  });
  const completeFirstRunGuide = useCallback(
    async (patch: { readonly dataMode?: 'live' | 'mock'; } = {}) => {
      setFirstRunGuideError(null);
      setFirstRunGuideSaving(true);
      try {
        const settingsPatch = {
          firstRunGuide: { completedAt: new Date().toISOString() },
          ...patch,
        };
        await repositories.settings.save(settingsPatch);
        settings.recordSettingsSaved(settingsPatch);
        setFirstRunGuideOpen(false);
        setLastAction(
          patch.dataMode === 'live' ? 'Switched to live mode' : 'First-run guide saved',
        );
      } catch (error) {
        setFirstRunGuideError(messageFromError(error, 'Could not save first-run guide.'));
        setLastAction(`First-run guide failed: ${messageFromError(error, 'Could not save.')}`);
      } finally {
        setFirstRunGuideSaving(false);
      }
    },
    [repositories.settings, settings],
  );
  const firstRunGuide = useMemo(() => ({
    errorMessage: firstRunGuideError,
    keepMock: () => void completeFirstRunGuide(),
    open: firstRunGuideOpen,
    openSettings: () => {
      void completeFirstRunGuide().then(() => settings.openSettings());
    },
    saving: firstRunGuideSaving,
    setOpen: setFirstRunGuideOpen,
    show: () => {
      setFirstRunGuideError(null);
      setFirstRunGuideOpen(true);
    },
    switchToLive: () => void completeFirstRunGuide({ dataMode: 'live' }),
  }), [
    completeFirstRunGuide,
    firstRunGuideError,
    firstRunGuideOpen,
    firstRunGuideSaving,
    settings,
  ]);
  const updates = useUpdateController({
    onStatus: setLastAction,
    recordActivity,
    settings: repositories.settings,
    updateApi: desktopAppApi,
  });
  const firestoreTab = useFirestoreTabState({
    activeProject,
    activeTab,
    initialDrafts: persistedWorkspace.snapshot?.drafts,
    onQueryActivity: recordActivity,
    selectedTreeItemId: selection.treeItemId,
  });
  const workspaceTree = useWorkspaceTree({
    activeTab,
    openFirestoreTab,
    openFirestoreTabInNewTab,
    openJsTabInNewTab,
    openToolTab,
    projects,
    selectedTreeItemId: selection.treeItemId,
    setLastAction,
  });
  const treeItems = useMemo(
    () =>
      demoMode
        ? workspaceTree.treeItems.map((item) => ({ ...item, canRemove: false }))
        : workspaceTree.treeItems,
    [demoMode, workspaceTree.treeItems],
  );
  useEffect(() => {
    let cancelled = false;
    void repositories.settings.load()
      .then((snapshot) => {
        if (!cancelled) {
          setDensity(snapshot.density);
          if (!demoMode && dataMode === 'mock' && !snapshot.firstRunGuide.completedAt) {
            setFirstRunGuideOpen(true);
          }
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDensity(defaultDensity);
        setLastAction(
          `Settings load failed: ${messageFromError(error, 'Could not load settings.')}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [dataMode, demoMode, repositories.settings]);
  const firestoreWrite = useFirestoreWriteController({
    activeProject,
    activeTab,
    clearSelectedDocument: (tabId) => firestoreTab.selectDocument(tabId, null),
    dataMode,
    firestore: repositories.firestore,
    onStatus: setLastAction,
    recordActivity,
    refreshAfterLiveWrite: workspaceTree.refreshLoadedRoots,
  });
  const authTab = useAuthTabState({
    activeProject,
    activeTab,
    initialAuthFilter: persistedWorkspace.snapshot?.authFilter,
    recordActivity,
    selectedUserId: selection.authUserId,
  });
  const jsTab = useJsTabState({
    activeTab,
    initialScripts: persistedWorkspace.snapshot?.scripts,
    recordActivity,
    selectedTreeItemId: selection.treeItemId,
  });
  const fdqlTab = useFdqlTabState({
    activeTab,
    initialSources: persistedWorkspace.snapshot?.fdqlSources,
    selectedTreeItemId: selection.treeItemId,
  });
  const sqlTab = useFirestoreSqlTabState({
    activeTab,
    initialContexts: persistedWorkspace.snapshot?.sqlContexts,
    initialSources: persistedWorkspace.snapshot?.sqlSources,
    selectedTreeItemId: selection.treeItemId,
  });
  const projectCommands = useProjectCommandController({
    projects: repositories.projects,
    recordActivity,
    reloadProjects: projectsQuery.reload,
    setLastAction,
  });
  const editingProject = editingProjectId
    ? projects.find((project) => project.id === editingProjectId) ?? null
    : null;
  const sidebarDefaultWidth = clampSidebarWidth(initialSidebarWidth);
  const workspaceSnapshot = useMemo(() => ({
    authFilter: authTab.authFilter,
    drafts: firestoreTab.drafts,
    fdqlSources: fdqlTab.sources,
    scripts: jsTab.scripts,
    sqlContexts: sqlTab.contexts,
    sqlSources: sqlTab.sources,
    tabsState,
  }), [
    authTab.authFilter,
    fdqlTab.sources,
    firestoreTab.drafts,
    jsTab.scripts,
    sqlTab.contexts,
    sqlTab.sources,
    tabsState,
  ]);

  useDocumentDensity(density);
  usePersistWorkspaceSnapshot(workspaceSnapshot, {
    enabled: persistedWorkspace.restored,
    onError: setWorkspacePersistenceError,
    settings: repositories.settings,
  });
  useEffect(() => {
    if (!workspacePersistenceError) return;
    setLastAction(`Workspace persistence failed: ${workspacePersistenceError.message}`);
    void recordActivity({
      action: workspacePersistenceError.operation === 'load'
        ? 'Load workspace state'
        : 'Save workspace state',
      area: 'workspace',
      error: { message: workspacePersistenceError.message },
      metadata: { operation: workspacePersistenceError.operation },
      status: 'failure',
      summary: workspacePersistenceError.message,
      target: { type: 'workspace' },
    });
  }, [recordActivity, workspacePersistenceError]);

  const controller = createAppShellController({
    activeProject,
    activeTab,
    activity: {
      button: activity.button,
      clear: activity.clear,
      close: activity.close,
      drawer: activity.drawer,
      exportEntries: activity.exportEntries,
      openTargetIntent: activity.openTargetIntent,
      setArea: activity.setArea,
      setExpanded: activity.setExpanded,
      setSearch: activity.setSearch,
      setStatus: activity.setStatus,
      toggle: activity.toggle,
    },
    addProjectOpen,
    appVersion,
    appearance: {
      mode: appearance.mode,
      resolvedTheme: appearance.resolvedTheme,
    },
    authTab,
    canOpenDataDirectory: Boolean(desktopAppApi),
    closeWorkspaceTabs: closeWorkspaceTabsCommand,
    credentialWarning,
    dataMode,
    demoMode,
    density,
    destructiveAction: {
      pendingAction: destructiveAction.pendingAction,
      setOpen: destructiveAction.setOpen,
    },
    editingProject,
    firestoreTab,
    firestoreWrite,
    fdqlTab,
    firstRunGuide,
    focusAuthFilter,
    focusTreeFilter,
    jsTab,
    sqlTab,
    jobs,
    lastAction,
    layout: {
      sidebarCollapsed,
      sidebarDefaultWidth,
      onSidebarResize: (size) => persistSidebarWidth(repositories, size),
    },
    nextCreateDocumentRequestId: () => nextCreateDocumentRequestId.current++,
    collectionJobRequest,
    nextCollectionJobRequestId: () => nextCollectionJobRequestId.current++,
    projects,
    jobsRepository: {
      pickExportFile: repositories.jobs.pickExportFile,
      pickImportFile: repositories.jobs.pickImportFile,
    },
    projectsRepository: repositories.projects,
    projectCommands,
    repositories: {
      firestore: {
        listSubcollections: repositories.firestore.listSubcollections,
      },
      settings: repositories.settings,
    },
    selection,
    settings,
    sidebarCollapsed,
    tabs: {
      goBackInteraction: tabActions.goBackInteraction,
      goForwardInteraction: tabActions.goForwardInteraction,
      openOrSelectTab: tabActions.openOrSelectTab,
      openTab: tabActions.openTab,
      reorderTabs: tabActions.reorderTabs,
      selectTab: tabActions.selectTab,
      sortByProject: tabActions.sortByProject,
    },
    tabsState,
    tree: {
      filter: workspaceTree.treeFilter,
      handleOpenItem: workspaceTree.handleOpenItem,
      handleRefreshItem: workspaceTree.handleRefreshItem,
      handleSelectItem: workspaceTree.handleSelectItem,
      handleToggleItem: workspaceTree.handleToggleItem,
      items: treeItems,
      refreshLoadedRoots: workspaceTree.refreshLoadedRoots,
      setFilter: workspaceTree.setTreeFilter,
    },
    updates,
    ui: {
      clearAuthSelection: () => selectionActions.selectAuthUser(null),
      recordInteraction: tabActions.recordInteraction,
      requestDestructiveAction: destructiveAction.request,
      restorePath: tabActions.restorePath,
      selectAuthUser: selectionActions.selectAuthUser,
      selectTreeItem: selectionActions.selectTreeItem,
      setAddProjectOpen,
      setCredentialWarning,
      setCollectionJobRequest,
      setEditingProjectId,
      setLastAction,
      setSidebarCollapsed,
      setTabsState: (state) => tabsStore.setState(() => state),
      updateActiveTabConnection: tabActions.updateConnection,
    },
  });

  useAppShellHotkeys(controller.hotkeys);

  return controller;

  function openToolTab(kind: Exclude<WorkspaceTabKind, 'firestore-query'>, connectionId: string) {
    return tabActions.openOrSelectTab({ kind, connectionId });
  }

  function openJsTabInNewTab(connectionId: string) {
    return tabActions.openTab({ kind: 'js-query', connectionId });
  }

  function openFirestoreTab(connectionId: string, path: string) {
    return firestoreTab.openTab(connectionId, path);
  }

  function openFirestoreTabInNewTab(connectionId: string, path: string) {
    return firestoreTab.openTabInNewTab(connectionId, path);
  }
}

function getDesktopAppApi(): DesktopAppApi | null {
  return typeof window !== 'undefined' ? window.firebaseDesk?.app ?? null : null;
}

function focusAuthFilter() {
  document.querySelector<HTMLInputElement>('input[aria-label="Filter users"]')?.focus();
}

function focusTreeFilter() {
  document.querySelector<HTMLInputElement>('input[aria-label="Filter account tree"]')?.focus();
}

function persistSidebarWidth(repositories: RepositorySet, size: number) {
  const width = clampSidebarWidth(size);
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  void repositories.settings.save({ sidebarWidth: width });
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
