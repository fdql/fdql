import type { FirestoreQueryDraftEdit } from '@firebase-desk/repo-contracts';
import { normalizeFirestorePath } from '../firestore/query/firestoreQueryDraft.ts';
import {
  applyFirestoreDraftEdit,
  firestoreDraftFingerprint,
} from '../firestore/query/firestoreQueryDraft.ts';
import type { FirestoreInspectorUiState } from '../firestore/query/firestoreQueryState.ts';
import {
  activePath,
  clampIndex,
  createEmptyTabsState,
  createInitialTabsState,
  createWorkspaceTab,
  defaultPathFor,
  initialSelectionState,
  interactionLocationForTab,
  keepActiveTab,
  normalizeWorkspaceTab,
  tabTitle,
  titleFor,
  treeItemIdForWorkspaceTab,
} from './workspaceState.ts';
import type {
  InteractionHistoryEntry,
  OpenFirestoreTargetInput,
  OpenTabInput,
  SelectionState,
  TabsState,
  WorkspaceTab,
} from './workspaceTypes.ts';

export function openFirestoreTarget(
  state: TabsState,
  input: OpenFirestoreTargetInput,
  tabId: string,
): { readonly state: TabsState; readonly tabId: string; } {
  const openInput: OpenTabInput = {
    connectionId: input.connectionId,
    ...(input.draft ? { draft: input.draft } : {}),
    kind: 'firestore-query',
    path: input.path,
  };
  return input.newTab
    ? tabOpened(state, openInput, tabId)
    : tabOpenedOrSelected(state, openInput, tabId);
}

export function tabsReset(connectionId?: string): TabsState {
  return connectionId ? createInitialTabsState(connectionId) : createEmptyTabsState();
}

export function tabsRestored(state: TabsState): TabsState {
  const normalized = normalizeUniqueTabs(state.tabs);
  const tabs = normalized.tabs;
  const interactionHistory: InteractionHistoryEntry[] = [];
  let interactionHistoryIndex = -1;
  state.interactionHistory.forEach((entry, index) => {
    const tab = restoredTabForEntry(normalized.tabsByOriginalId.get(entry.activeTabId), entry);
    if (!tab) return;
    interactionHistory.push({ ...entry, activeTabId: tab.id });
    if (index <= state.interactionHistoryIndex) {
      interactionHistoryIndex = interactionHistory.length - 1;
    }
  });
  const activeHistoryEntry = interactionHistory[interactionHistoryIndex];
  const activeTabId = activeHistoryEntry
      && state.interactionHistory[state.interactionHistoryIndex]?.activeTabId === state.activeTabId
    ? activeHistoryEntry.activeTabId
    : normalized.tabsByOriginalId.get(state.activeTabId)?.[0]?.id ?? state.activeTabId;
  return {
    activeTabId: keepActiveTab(activeTabId, tabs),
    interactionHistory,
    interactionHistoryIndex: clampIndex(interactionHistoryIndex, interactionHistory),
    selectedTreeItemId: state.selectedTreeItemId ?? null,
    tabs,
  };
}

export function tabOpened(
  state: TabsState,
  input: OpenTabInput,
  tabId: string,
): { readonly state: TabsState; readonly tabId: string; } {
  const current = snapshotCurrentInteraction(state);
  const tab = createWorkspaceTab(input, uniqueTabId(tabId, tabIdsFor(state.tabs)));
  return {
    state: {
      ...current,
      activeTabId: tab.id,
      selectedTreeItemId: treeItemIdForWorkspaceTab(tab),
      tabs: [...current.tabs, tab],
    },
    tabId: tab.id,
  };
}

export function tabDuplicated(
  state: TabsState,
  sourceTabId: string,
  tabId: string,
): { readonly state: TabsState; readonly tabId: string | null; } {
  const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceTabId);
  const source = state.tabs[sourceIndex];
  if (!source) return { state, tabId: null };
  const nextTab: WorkspaceTab = source.kind === 'firestore-query'
    ? {
      ...source,
      draft: { ...source.draft, filters: [...(source.draft.filters ?? [])] },
      id: uniqueTabId(tabId, tabIdsFor(state.tabs)),
      inspectorUi: {
        ...source.inspectorUi,
        sections: { ...source.inspectorUi.sections },
        selectionPreviewExpandedPathsByDocumentPath: {},
      },
    }
    : { ...source, id: uniqueTabId(tabId, tabIdsFor(state.tabs)) };
  const current = snapshotCurrentInteraction(state);
  return {
    state: {
      ...current,
      activeTabId: nextTab.id,
      selectedTreeItemId: treeItemIdForWorkspaceTab(nextTab),
      tabs: [
        ...current.tabs.slice(0, sourceIndex + 1),
        nextTab,
        ...current.tabs.slice(sourceIndex + 1),
      ],
    },
    tabId: nextTab.id,
  };
}

export function tabOpenedOrSelected(
  state: TabsState,
  input: OpenTabInput,
  tabId: string,
): { readonly state: TabsState; readonly tabId: string; } {
  const existing = findOpenWorkspaceTab(state, input);
  if (existing) return { state: tabSelected(state, existing.id), tabId: existing.id };
  return tabOpened(state, input, tabId);
}

export function findOpenWorkspaceTab(
  state: TabsState,
  input: OpenTabInput,
): WorkspaceTab | undefined {
  const requestedPath = input.kind === 'firestore-query'
    ? input.path ?? input.draft?.path ?? defaultPathFor(input.kind)
    : input.path ?? defaultPathFor(input.kind);
  const path = input.kind === 'firestore-query'
    ? normalizeFirestorePath(requestedPath)
    : requestedPath;
  if (input.kind === 'firestore-query' && !path) return undefined;
  const matches = state.tabs.filter((tab) =>
    tab.kind === input.kind && tab.connectionId === input.connectionId && activePath(tab) === path
  );
  if (!matches.length) return undefined;
  const active = matches.find((tab) => tab.id === state.activeTabId);
  if (active) return active;
  for (let index = state.interactionHistory.length - 1; index >= 0; index -= 1) {
    const tabId = state.interactionHistory[index]?.activeTabId;
    const recent = matches.find((tab) => tab.id === tabId);
    if (recent) return recent;
  }
  return matches[0];
}

export function tabSelected(state: TabsState, tabId: string): TabsState {
  if (state.activeTabId === tabId || !state.tabs.some((tab) => tab.id === tabId)) return state;
  const tab = state.tabs.find((item) => item.id === tabId)!;
  return {
    ...snapshotCurrentInteraction(state),
    activeTabId: tabId,
    selectedTreeItemId: treeItemIdForWorkspaceTab(tab),
  };
}

export function tabClosed(state: TabsState, tabId: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId = state.activeTabId === tabId
    ? tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? ''
    : state.activeTabId;
  const next = sanitizeOpenTabReferences({ ...state, activeTabId, tabs });
  const activeTab = next.tabs.find((tab) => tab.id === next.activeTabId);
  return state.activeTabId === tabId
    ? { ...next, selectedTreeItemId: activeTab ? treeItemIdForWorkspaceTab(activeTab) : null }
    : next;
}

export function otherTabsClosed(state: TabsState, tabId: string): TabsState {
  const tab = state.tabs.find((item) => item.id === tabId);
  return tab ? sanitizeOpenTabReferences({ ...state, activeTabId: tab.id, tabs: [tab] }) : state;
}

export function tabsToLeftClosed(state: TabsState, tabId: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index <= 0) return state;
  const tabs = state.tabs.slice(index);
  return sanitizeOpenTabReferences({
    ...state,
    activeTabId: keepActiveTab(state.activeTabId, tabs),
    tabs,
  });
}

export function tabsToRightClosed(state: TabsState, tabId: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0 || index === state.tabs.length - 1) return state;
  const tabs = state.tabs.slice(0, index + 1);
  return sanitizeOpenTabReferences({
    ...state,
    activeTabId: keepActiveTab(state.activeTabId, tabs),
    tabs,
  });
}

export function allTabsClosed(state: TabsState): TabsState {
  return {
    ...state,
    activeTabId: '',
    interactionHistory: [],
    interactionHistoryIndex: 0,
    selectedTreeItemId: null,
    tabs: [],
  };
}

export function tabsReordered(state: TabsState, activeId: string, overId: string): TabsState {
  const from = state.tabs.findIndex((tab) => tab.id === activeId);
  const to = state.tabs.findIndex((tab) => tab.id === overId);
  if (from < 0 || to < 0 || from === to) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved!);
  return { ...state, tabs };
}

export function tabsSortedByProject(state: TabsState): TabsState {
  const tabs: WorkspaceTab[] = [];
  for (const tab of state.tabs) {
    const index = tabs.findIndex((item) => compareTabsByProject(tab, item) < 0);
    if (index < 0) tabs.push(tab);
    else tabs.splice(index, 0, tab);
  }
  return { ...state, tabs };
}

export function tabConnectionUpdated(
  state: TabsState,
  tabId: string,
  connectionId: string,
): TabsState {
  const updated = tabUpdated(snapshotCurrentInteraction(state), tabId, (tab) => ({
    ...tab,
    connectionId,
  }));
  const tab = updated.tabs.find((item) => item.id === tabId);
  return tabId === updated.activeTabId && tab
    ? { ...updated, selectedTreeItemId: treeItemIdForWorkspaceTab(tab) }
    : updated;
}

export function tabHistoryPushed(state: TabsState, tabId: string, path: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
    if (tab.kind === 'firestore-query') return tab;
    const current = tab.history[tab.historyIndex];
    if (current === path) return tab;
    const history = [...tab.history.slice(0, tab.historyIndex + 1), path];
    return { ...tab, history, historyIndex: history.length - 1, title: titleFor(tab.kind, path) };
  });
}

export function tabHistoryMovedBack(state: TabsState, tabId: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
    if (tab.kind === 'firestore-query') return tab;
    const historyIndex = Math.max(0, tab.historyIndex - 1);
    return { ...tab, historyIndex, title: titleFor(tab.kind, tab.history[historyIndex] ?? '') };
  });
}

export function tabHistoryMovedForward(state: TabsState, tabId: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
    if (tab.kind === 'firestore-query') return tab;
    const historyIndex = Math.min(tab.history.length - 1, tab.historyIndex + 1);
    return { ...tab, historyIndex, title: titleFor(tab.kind, tab.history[historyIndex] ?? '') };
  });
}

export function tabInspectorWidthChanged(
  state: TabsState,
  tabId: string,
  inspectorWidth: number,
): TabsState {
  return tabUpdated(state, tabId, (tab) => ({ ...tab, inspectorWidth }));
}

export function firestoreTabDraftEdited(
  state: TabsState,
  tabId: string,
  edit: FirestoreQueryDraftEdit,
): { readonly queryChanged: boolean; readonly state: TabsState; } {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab || tab.kind !== 'firestore-query') return { queryChanged: false, state };
  const draft = applyFirestoreDraftEdit(tab.draft, edit);
  const queryChanged = firestoreDraftFingerprint(tab.connectionId, tab.draft)
    !== firestoreDraftFingerprint(tab.connectionId, draft);
  const updated = tabUpdated(
    state,
    tabId,
    (item) => item.kind === 'firestore-query' ? { ...item, draft } : item,
  );
  const selectedTreeItemId = tabId === state.activeTabId
    ? treeItemIdForWorkspaceTab({ ...tab, draft })
    : state.selectedTreeItemId;
  return {
    queryChanged,
    state: { ...updated, selectedTreeItemId },
  };
}

export function firestoreTabInspectorUiChanged(
  state: TabsState,
  tabId: string,
  inspectorUi: FirestoreInspectorUiState,
): TabsState {
  return tabUpdated(
    state,
    tabId,
    (tab) => tab.kind === 'firestore-query' ? { ...tab, inspectorUi } : tab,
  );
}

export function tabPathRestored(state: TabsState, tabId: string, path: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
    if (tab.kind === 'firestore-query') return { ...tab, draft: { ...tab.draft, path } };
    const index = tab.history.findIndex((item) => item === path);
    if (index >= 0) return { ...tab, historyIndex: index, title: titleFor(tab.kind, path) };
    const history = [...tab.history, path];
    return { ...tab, history, historyIndex: history.length - 1, title: titleFor(tab.kind, path) };
  });
}

export function interactionRecorded(
  state: TabsState,
  entry: InteractionHistoryEntry,
): TabsState {
  const current = state.interactionHistory[state.interactionHistoryIndex];
  if (
    current?.activeTabId === entry.activeTabId
    && locationsEqual(current.location, entry.location)
    && current.selectedTreeItemId === entry.selectedTreeItemId
  ) return state;
  const interactionHistory = [
    ...state.interactionHistory.slice(0, state.interactionHistoryIndex + 1),
    entry,
  ];
  return {
    ...state,
    interactionHistory,
    interactionHistoryIndex: interactionHistory.length - 1,
    selectedTreeItemId: entry.selectedTreeItemId,
  };
}

export function interactionMovedBack(
  state: TabsState,
  availableConnectionIds?: ReadonlySet<string>,
): { readonly entry: InteractionHistoryEntry | null; readonly state: TabsState; } {
  const sanitized = sanitizeInteractionHistory(
    snapshotCurrentInteraction(state),
    availableConnectionIds,
  );
  const interactionHistoryIndex = Math.max(0, sanitized.interactionHistoryIndex - 1);
  if (interactionHistoryIndex === sanitized.interactionHistoryIndex) {
    return { entry: null, state: sanitized };
  }
  const entry = sanitized.interactionHistory[interactionHistoryIndex] ?? null;
  return {
    entry,
    state: entry ? restoreInteractionEntry(sanitized, entry, interactionHistoryIndex) : sanitized,
  };
}

export function interactionMovedForward(
  state: TabsState,
  availableConnectionIds?: ReadonlySet<string>,
): { readonly entry: InteractionHistoryEntry | null; readonly state: TabsState; } {
  const sanitized = sanitizeInteractionHistory(
    snapshotCurrentInteraction(state),
    availableConnectionIds,
  );
  const interactionHistoryIndex = Math.min(
    sanitized.interactionHistory.length - 1,
    sanitized.interactionHistoryIndex + 1,
  );
  if (interactionHistoryIndex === sanitized.interactionHistoryIndex) {
    return { entry: null, state: sanitized };
  }
  const entry = sanitized.interactionHistory[interactionHistoryIndex] ?? null;
  return {
    entry,
    state: entry ? restoreInteractionEntry(sanitized, entry, interactionHistoryIndex) : sanitized,
  };
}

export function workspaceTreeItemSelected(
  state: TabsState,
  treeItemId: string | null,
): TabsState {
  return { ...state, selectedTreeItemId: treeItemId };
}

export function selectionReset(): SelectionState {
  return initialSelectionState;
}

export function authUserSelected(state: SelectionState, uid: string | null): SelectionState {
  return { ...state, authUserId: uid };
}

export function tabCounterFor(tab: WorkspaceTab): number {
  const match = /-(\d+)$/.exec(tab.id);
  return match ? Number(match[1]) || 0 : 0;
}

function tabUpdated(
  state: TabsState,
  tabId: string,
  updater: (tab: WorkspaceTab) => WorkspaceTab,
): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === tabId ? updater(tab) : tab),
  };
}

function compareTabsByProject(left: WorkspaceTab, right: WorkspaceTab): number {
  const project = left.connectionId.localeCompare(right.connectionId);
  if (project !== 0) return project;
  return tabTitle(left).localeCompare(tabTitle(right));
}

function normalizeUniqueTabs(tabs: ReadonlyArray<WorkspaceTab>): {
  readonly tabs: ReadonlyArray<WorkspaceTab>;
  readonly tabsByOriginalId: ReadonlyMap<string, ReadonlyArray<WorkspaceTab>>;
} {
  const seen = new Set<string>();
  const tabsByOriginalId = new Map<string, WorkspaceTab[]>();
  const normalizedTabs = tabs.map((tab) => {
    const originalId = tab.id;
    const normalized = normalizeWorkspaceTab(tab);
    const id = uniqueTabId(normalized.id, seen);
    seen.add(id);
    const result = id === normalized.id ? normalized : { ...normalized, id };
    const candidates = tabsByOriginalId.get(originalId) ?? [];
    candidates.push(result);
    tabsByOriginalId.set(originalId, candidates);
    return result;
  });
  return { tabs: normalizedTabs, tabsByOriginalId };
}

function restoredTabForEntry(
  candidates: ReadonlyArray<WorkspaceTab> | undefined,
  entry: InteractionHistoryEntry,
): WorkspaceTab | undefined {
  if (!candidates?.length) return undefined;
  return candidates.find((tab) => {
    if (entry.location.kind === 'firestore-query') {
      return tab.kind === 'firestore-query'
        && tab.connectionId === entry.location.connectionId
        && firestoreDraftFingerprint(tab.connectionId, tab.draft)
          === firestoreDraftFingerprint(entry.location.connectionId, entry.location.draft);
    }
    return tab.kind !== 'firestore-query'
      && tab.connectionId === entry.location.connectionId
      && activePath(tab) === entry.location.path;
  }) ?? candidates[0];
}

function tabIdsFor(tabs: ReadonlyArray<WorkspaceTab>): Set<string> {
  return new Set(tabs.map((tab) => tab.id));
}

function uniqueTabId(id: string, seen: ReadonlySet<string>): string {
  if (!seen.has(id)) return id;
  for (let index = 2;; index += 1) {
    const candidate = `${id}-${index}`;
    if (!seen.has(candidate)) return candidate;
  }
}

function sanitizeOpenTabReferences(state: TabsState): TabsState {
  const sanitized = sanitizeInteractionHistory(state);
  return {
    ...sanitized,
    activeTabId: keepActiveTab(sanitized.activeTabId, sanitized.tabs),
  };
}

function sanitizeInteractionHistory(
  state: TabsState,
  availableConnectionIds?: ReadonlySet<string>,
): TabsState {
  const tabIds = tabIdsFor(state.tabs);
  const interactionHistory: InteractionHistoryEntry[] = [];
  let interactionHistoryIndex = -1;
  state.interactionHistory.forEach((entry, index) => {
    if (
      !tabIds.has(entry.activeTabId)
      || (availableConnectionIds && !availableConnectionIds.has(entry.location.connectionId))
    ) return;
    interactionHistory.push(entry);
    if (index <= state.interactionHistoryIndex) {
      interactionHistoryIndex = interactionHistory.length - 1;
    }
  });
  return {
    ...state,
    interactionHistory,
    interactionHistoryIndex: clampIndex(interactionHistoryIndex, interactionHistory),
  };
}

function snapshotCurrentInteraction(state: TabsState): TabsState {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return state;
  const entry: InteractionHistoryEntry = {
    activeTabId: tab.id,
    location: interactionLocationForTab(tab),
    selectedTreeItemId: state.selectedTreeItemId,
  };
  const current = state.interactionHistory[state.interactionHistoryIndex];
  if (
    current?.activeTabId === entry.activeTabId
    && current.selectedTreeItemId === entry.selectedTreeItemId
    && locationsEqual(current.location, entry.location)
  ) return state;
  return interactionRecorded(state, entry);
}

function restoreInteractionEntry(
  state: TabsState,
  entry: InteractionHistoryEntry,
  interactionHistoryIndex: number,
): TabsState {
  return {
    ...tabUpdated(state, entry.activeTabId, (tab) => {
      if (entry.location.kind === 'firestore-query' && tab.kind === 'firestore-query') {
        return {
          ...tab,
          connectionId: entry.location.connectionId,
          draft: {
            ...entry.location.draft,
            ...(entry.location.draft.filters
              ? { filters: entry.location.draft.filters.map((filter) => ({ ...filter })) }
              : {}),
          },
        };
      }
      if (entry.location.kind === 'tool' && tab.kind !== 'firestore-query') {
        const path = entry.location.path;
        const index = tab.history.findIndex((item) => item === path);
        const history = index >= 0 ? tab.history : [...tab.history, path];
        return {
          ...tab,
          connectionId: entry.location.connectionId,
          history,
          historyIndex: index >= 0 ? index : history.length - 1,
          title: titleFor(tab.kind, path),
        };
      }
      return tab;
    }),
    activeTabId: entry.activeTabId,
    interactionHistoryIndex,
    selectedTreeItemId: entry.selectedTreeItemId,
  };
}

function locationsEqual(
  left: InteractionHistoryEntry['location'],
  right: InteractionHistoryEntry['location'],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
