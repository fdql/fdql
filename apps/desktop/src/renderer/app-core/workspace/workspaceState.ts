import {
  createFirestoreDraft,
  firestoreCollectionPathForTarget,
  normalizeFirestorePath,
} from '../firestore/query/firestoreQueryDraft.ts';
import { defaultFirestoreInspectorUiState } from '../firestore/query/firestoreQueryState.ts';
import type {
  FirestoreQueryTab,
  OpenTabInput,
  SelectionState,
  TabsState,
  ToolWorkspaceTab,
  WorkspaceInteractionLocation,
  WorkspaceTab,
  WorkspaceTabKind,
} from './workspaceTypes.ts';

export const DEFAULT_INSPECTOR_WIDTH = 360;

export const initialSelectionState: SelectionState = {
  authUserId: null,
};

export function createEmptyTabsState(): TabsState {
  return {
    activeTabId: '',
    interactionHistory: [],
    interactionHistoryIndex: 0,
    selectedTreeItemId: null,
    tabs: [],
  };
}

export function createInitialTabsState(connectionId: string): TabsState {
  return {
    activeTabId: 'tab-firestore',
    interactionHistory: [{
      activeTabId: 'tab-firestore',
      location: {
        kind: 'firestore-query',
        connectionId,
        draft: createFirestoreDraft('orders'),
      },
      selectedTreeItemId: null,
    }],
    interactionHistoryIndex: 0,
    selectedTreeItemId: null,
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
  if (input.kind === 'firestore-query') {
    return {
      id: tabId,
      kind: input.kind,
      connectionId: input.connectionId,
      draft: input.draft ?? createFirestoreDraft(path),
      inspectorUi: defaultFirestoreInspectorUiState(),
      inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    };
  }
  return createFixedWorkspaceTab(tabId, input.kind, input.connectionId, path);
}

export function createFixedWorkspaceTab(
  id: string,
  kind: WorkspaceTabKind,
  connectionId: string,
  path: string,
): WorkspaceTab {
  if (kind === 'firestore-query') {
    return {
      id,
      kind,
      connectionId,
      draft: createFirestoreDraft(path),
      inspectorUi: defaultFirestoreInspectorUiState(),
      inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    };
  }
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
  if (tab.kind === 'firestore-query') return normalizeFirestorePath(tab.draft.path);
  return tab.history[tab.historyIndex] ?? '';
}

export function normalizeWorkspaceTab(tab: WorkspaceTab): WorkspaceTab {
  if (tab.kind === 'firestore-query') {
    return {
      ...tab,
      draft: { ...tab.draft, filters: [...(tab.draft.filters ?? [])] },
      inspectorWidth: Number.isFinite(tab.inspectorWidth)
        ? tab.inspectorWidth
        : DEFAULT_INSPECTOR_WIDTH,
    };
  }
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

export function tabTitle(tab: WorkspaceTab): string {
  return tab.kind === 'firestore-query'
    ? titleFor(tab.kind, normalizeFirestorePath(tab.draft.path))
    : tab.title;
}

export function treeItemIdForWorkspaceTab(tab: WorkspaceTab): string {
  if (tab.kind === 'firestore-query') {
    const path = firestoreCollectionPathForTarget(tab.draft.path);
    return path ? `collection:${tab.connectionId}:${path}` : `firestore:${tab.connectionId}`;
  }
  if (tab.kind === 'auth-users') return `auth:${tab.connectionId}`;
  if (tab.kind === 'js-query') return `script:${tab.connectionId}`;
  if (tab.kind === 'firestore-sql') return `sql:${tab.connectionId}`;
  return `fdql:${tab.connectionId}`;
}

export function interactionLocationForTab(tab: WorkspaceTab): WorkspaceInteractionLocation {
  return tab.kind === 'firestore-query'
    ? {
      kind: tab.kind,
      connectionId: tab.connectionId,
      draft: {
        ...tab.draft,
        ...(tab.draft.filters
          ? { filters: tab.draft.filters.map((filter) => ({ ...filter })) }
          : {}),
      },
    }
    : {
      kind: 'tool',
      connectionId: tab.connectionId,
      path: activePath(tab),
    };
}

export function isFirestoreQueryTab(tab: WorkspaceTab): tab is FirestoreQueryTab {
  return tab.kind === 'firestore-query';
}

export function isToolWorkspaceTab(tab: WorkspaceTab): tab is ToolWorkspaceTab {
  return tab.kind !== 'firestore-query';
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
  if (kind === 'firestore-sql') return 'sql/default';
  return 'fdql/default';
}

export function titleFor(kind: WorkspaceTabKind, path: string): string {
  if (kind === 'firestore-query') return path || 'Firestore';
  if (kind === 'auth-users') return 'Auth';
  if (kind === 'js-query') return 'JS Query';
  if (kind === 'firestore-sql') return 'SQL';
  return 'FDQL';
}

export function clampIndex(index: number, values: ReadonlyArray<unknown>): number {
  if (!values.length) return 0;
  return Math.min(values.length - 1, Math.max(0, Math.trunc(index)));
}
