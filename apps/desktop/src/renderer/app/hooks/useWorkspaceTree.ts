import type { FirestoreCollectionNode, ProjectSummary } from '@firebase-desk/repo-contracts';
import { useMemo, useRef, useState } from 'react';
import {
  openWorkspaceTreeItemCommand,
  selectWorkspaceTreeItemCommand,
  type WorkspaceTreeTarget,
} from '../../app-core/workspace/workspaceTreeCommands.ts';
import { useRepositories } from '../RepositoryProvider.tsx';
import {
  activePath,
  tabActions,
  tabsStore,
  type WorkspaceTab,
  type WorkspaceTabKind,
} from '../stores/tabsStore.ts';
import {
  buildTreeItems,
  initialTreeCache,
  type LoadState,
  parentIdForStatus,
  parseTreeId,
  toggleSet,
  type TreeCache,
} from '../workspaceModel.ts';

interface UseWorkspaceTreeInput {
  readonly activeTab: WorkspaceTab | undefined;
  readonly openFirestoreTab: (connectionId: string, path: string) => string;
  readonly openFirestoreTabInNewTab: (connectionId: string, path: string) => string;
  readonly openToolTab: (
    kind: Exclude<WorkspaceTabKind, 'firestore-query'>,
    connectionId: string,
    options?: { readonly newTab?: boolean; } | undefined,
  ) => string;
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly selectedTreeItemId: string | null;
  readonly setLastAction: (action: string) => void;
}

export function useWorkspaceTree(
  {
    activeTab,
    openFirestoreTab,
    openFirestoreTabInNewTab,
    openToolTab,
    projects,
    selectedTreeItemId,
    setLastAction,
  }: UseWorkspaceTreeInput,
) {
  const repositories = useRepositories();
  const [treeFilter, setTreeFilter] = useState('');
  const lastSelectionRef = useRef<
    {
      readonly created: boolean;
      readonly id: string;
      readonly tabId: string;
    } | null
  >(null);
  const [expandedTreeIds, setExpandedTreeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [treeCache, setTreeCache] = useState<TreeCache>(initialTreeCache);
  const treeItems = useMemo(
    () => buildTreeItems(projects, expandedTreeIds, treeCache, selectedTreeItemId, treeFilter),
    [expandedTreeIds, projects, selectedTreeItemId, treeCache, treeFilter],
  );

  async function loadRoots(project: ProjectSummary, refresh = false) {
    const key = project.id;
    if (!refresh && treeCache.roots[key]?.status === 'success') return;
    setRootState(key, { status: 'loading', items: [] });
    try {
      const items = await repositories.firestore.listRootCollections(project.id);
      setRootState(key, { status: 'success', items });
      setLastAction(
        `Loaded ${items.length} root collection${
          items.length === 1 ? '' : 's'
        } from ${project.projectId}`,
      );
    } catch (error) {
      const errorMessage = messageFromError(error);
      setRootState(key, { status: 'error', items: [], errorMessage });
      setLastAction(`Firestore load failed: ${errorMessage}`);
    }
  }

  async function refreshLoadedRoots() {
    await Promise.all(
      projects
        .filter((project) => treeCache.roots[project.id]?.status === 'success')
        .map((project) => loadRoots(project, true)),
    );
  }

  async function loadProjectTools(project: ProjectSummary, refresh = false) {
    const key = project.id;
    if (!refresh && treeCache.tools[key]?.status === 'success') return;
    setToolState(key, { status: 'loading', items: [] });
    try {
      await Promise.resolve();
      setToolState(key, { status: 'success', items: ['tools'] });
    } catch {
      setToolState(key, { status: 'error', items: [] });
    }
  }

  function handleToggleItem(id: string) {
    const statusParentId = parentIdForStatus(id);
    if (statusParentId) {
      handleRefreshItem(statusParentId);
      return;
    }
    const parsed = parseTreeId(id);
    const willExpand = !expandedTreeIds.has(id);
    setExpandedTreeIds((current) => toggleSet(current, id));
    if (!willExpand) return;
    const project = projects.find((item) => item.id === parsed.connectionId);
    if (!project) return;
    if (parsed.kind === 'project') void loadProjectTools(project);
    if (parsed.kind === 'firestore') void loadRoots(project);
  }

  function handleRefreshItem(id: string) {
    const retryParentId = parentIdForStatus(id) ?? id;
    const parsed = parseTreeId(retryParentId);
    const project = projects.find((item) => item.id === parsed.connectionId);
    if (!project) return;
    if (parsed.kind === 'project') void loadProjectTools(project, true);
    if (parsed.kind === 'firestore') void loadRoots(project, true);
    setLastAction(`Retried ${project.name}`);
  }

  function handleSelectItem(id: string) {
    const statusParentId = parentIdForStatus(id);
    if (statusParentId) {
      handleRefreshItem(statusParentId);
      return;
    }
    const parsed = parseTreeId(id);
    const result = selectWorkspaceTreeItemCommand({
      activeTab: activeTab
        ? { id: activeTab.id, path: activePath(activeTab) }
        : { id: tabsStore.state.activeTabId },
      item: parsed,
      selectedTreeItemId: id,
    });
    const tabIdsBeforeOpen = new Set(tabsStore.state.tabs.map((tab) => tab.id));
    const opened = recordTreeTarget(result.target, id);
    lastSelectionRef.current = opened?.tabId
      ? { created: !tabIdsBeforeOpen.has(opened.tabId), id, tabId: opened.tabId }
      : null;
    setLastAction(result.lastAction);
  }

  function handleOpenItem(id: string) {
    const selection = lastSelectionRef.current;
    lastSelectionRef.current = null;
    if (
      selection?.id === id
      && selection.created
      && tabsStore.state.tabs.some((tab) => tab.id === selection.tabId)
    ) {
      tabActions.selectTab(selection.tabId);
      tabActions.recordInteraction({
        activeTabId: selection.tabId,
        selectedTreeItemId: id,
      });
      return;
    }
    const parsed = parseTreeId(id);
    recordTreeTarget(openWorkspaceTreeItemCommand(parsed).target, id);
  }

  function setRootState(key: string, state: LoadState<FirestoreCollectionNode>) {
    setTreeCache((current) => ({ ...current, roots: { ...current.roots, [key]: state } }));
  }

  function setToolState(key: string, state: LoadState<'tools'>) {
    setTreeCache((current) => ({ ...current, tools: { ...current.tools, [key]: state } }));
  }

  function recordTreeTarget(target: WorkspaceTreeTarget | null, targetTreeItemId: string) {
    if (!target) return null;
    const opened = openTreeTarget(target);
    if (!opened.tabId) return null;
    tabActions.recordInteraction({
      activeTabId: opened.tabId,
      selectedTreeItemId: targetTreeItemId,
    });
    return opened;
  }

  function openTreeTarget(
    target: WorkspaceTreeTarget,
  ): { readonly path?: string | undefined; readonly tabId: string | null; } {
    if (target.type === 'current') return { path: target.path, tabId: target.activeTabId };
    if (target.type === 'open-firestore') {
      return {
        path: target.path,
        tabId: target.newTab
          ? openFirestoreTabInNewTab(target.connectionId, target.path)
          : openFirestoreTab(target.connectionId, target.path),
      };
    }
    return {
      path: target.path,
      tabId: openToolTab(target.kind, target.connectionId, { newTab: target.newTab }),
    };
  }

  return {
    treeFilter,
    treeItems,
    handleOpenItem,
    handleRefreshItem,
    handleSelectItem,
    handleToggleItem,
    refreshLoadedRoots,
    setTreeFilter,
  };
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Could not load Firestore collections.';
}
