import type {
  OpenTabInput,
  SelectionState,
  TabsState,
  WorkspaceTab,
  WorkspaceTabKind,
} from './workspaceTypes.ts';

export const DEFAULT_INSPECTOR_WIDTH = 360;

export const initialSelectionState: SelectionState = {
  authUserId: null,
  treeItemId: null,
};

export function createEmptyTabsState(): TabsState {
  return {
    activeTabId: '',
    interactionHistory: [],
    interactionHistoryIndex: 0,
    tabs: [],
  };
}

export function createInitialTabsState(connectionId: string): TabsState {
  return {
    activeTabId: 'tab-firestore',
    interactionHistory: [{
      activeTabId: 'tab-firestore',
      path: 'orders',
      selectedTreeItemId: null,
    }],
    interactionHistoryIndex: 0,
    tabs: [
      createFixedWorkspaceTab('tab-firestore', 'firestore-query', connectionId, 'orders'),
      createFixedWorkspaceTab('tab-auth', 'auth-users', connectionId, 'auth/users'),
      createFixedWorkspaceTab('tab-js', 'js-query', connectionId, 'scripts/default'),
      createFixedWorkspaceTab('tab-sql', 'firestore-sql', connectionId, 'sql/default'),
    ],
  };
}

export function createWorkspaceTab(input: OpenTabInput, tabId: string): WorkspaceTab {
  const path = input.path ?? defaultPathFor(input.kind);
  return createFixedWorkspaceTab(tabId, input.kind, input.connectionId, path);
}

export function createFixedWorkspaceTab(
  id: string,
  kind: WorkspaceTabKind,
  connectionId: string,
  path: string,
): WorkspaceTab {
  return {
    id,
    kind,
    connectionId,
    title: titleFor(kind, path),
    history: [path],
    historyIndex: 0,
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
  };
}

export function activePath(tab: WorkspaceTab): string {
  return tab.history[tab.historyIndex] ?? '';
}

export function normalizeWorkspaceTab(tab: WorkspaceTab): WorkspaceTab {
  const history = tab.history.length ? tab.history : [defaultPathFor(tab.kind)];
  const historyIndex = clampIndex(tab.historyIndex, history);
  return {
    ...tab,
    history,
    historyIndex,
    inspectorWidth: Number.isFinite(tab.inspectorWidth)
      ? tab.inspectorWidth
      : DEFAULT_INSPECTOR_WIDTH,
    title: titleFor(tab.kind, history[historyIndex] ?? ''),
  };
}

export function keepActiveTab(
  activeTabId: string,
  tabs: ReadonlyArray<WorkspaceTab>,
): string {
  if (tabs.some((tab) => tab.id === activeTabId)) return activeTabId;
  return tabs[0]?.id ?? '';
}

export function defaultPathFor(kind: WorkspaceTabKind): string {
  if (kind === 'firestore-query') return 'orders';
  if (kind === 'auth-users') return 'auth/users';
  if (kind === 'js-query') return 'scripts/default';
  return 'sql/default';
}

export function titleFor(kind: WorkspaceTabKind, path: string): string {
  if (kind === 'firestore-query') return path || 'Firestore';
  if (kind === 'auth-users') return 'Auth';
  if (kind === 'js-query') return 'JS Query';
  return 'SQL';
}

export function clampIndex(index: number, values: ReadonlyArray<unknown>): number {
  if (!values.length) return 0;
  return Math.min(values.length - 1, Math.max(0, Math.trunc(index)));
}
