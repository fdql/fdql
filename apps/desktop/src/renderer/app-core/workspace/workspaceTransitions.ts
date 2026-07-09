import {
  activePath,
  clampIndex,
  createEmptyTabsState,
  createInitialTabsState,
  createWorkspaceTab,
  defaultPathFor,
  initialSelectionState,
  keepActiveTab,
  normalizeWorkspaceTab,
  titleFor,
} from './workspaceState.ts';
import type {
  InteractionHistoryEntry,
  OpenTabInput,
  SelectionState,
  TabsState,
  WorkspaceTab,
} from './workspaceTypes.ts';

export function tabsReset(connectionId?: string): TabsState {
  return connectionId ? createInitialTabsState(connectionId) : createEmptyTabsState();
}

export function tabsRestored(state: TabsState): TabsState {
  const tabs = normalizeUniqueTabs(state.tabs);
  const interactionHistory = state.interactionHistory.filter((entry) =>
    tabs.some((tab) => tab.id === entry.activeTabId)
  );
  return {
    activeTabId: keepActiveTab(state.activeTabId, tabs),
    interactionHistory,
    interactionHistoryIndex: clampIndex(state.interactionHistoryIndex, interactionHistory),
    tabs,
  };
}

export function tabOpened(
  state: TabsState,
  input: OpenTabInput,
  tabId: string,
): { readonly state: TabsState; readonly tabId: string; } {
  const tab = createWorkspaceTab(input, uniqueTabId(tabId, tabIdsFor(state.tabs)));
  return {
    state: {
      ...state,
      activeTabId: tab.id,
      tabs: [...state.tabs, tab],
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
  const nextTab = {
    ...source,
    id: uniqueTabId(tabId, tabIdsFor(state.tabs)),
  };
  return {
    state: {
      ...state,
      activeTabId: nextTab.id,
      tabs: [
        ...state.tabs.slice(0, sourceIndex + 1),
        nextTab,
        ...state.tabs.slice(sourceIndex + 1),
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
  const path = input.path ?? defaultPathFor(input.kind);
  return state.tabs.find((tab) =>
    tab.kind === input.kind && tab.connectionId === input.connectionId && activePath(tab) === path
  );
}

export function tabSelected(state: TabsState, tabId: string): TabsState {
  return state.tabs.some((tab) => tab.id === tabId) ? { ...state, activeTabId: tabId } : state;
}

export function tabClosed(state: TabsState, tabId: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId = state.activeTabId === tabId
    ? tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? ''
    : state.activeTabId;
  return sanitizeOpenTabReferences({ ...state, activeTabId, tabs });
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
  return tabUpdated(state, tabId, (tab) => ({ ...tab, connectionId }));
}

export function tabHistoryPushed(state: TabsState, tabId: string, path: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
    const current = tab.history[tab.historyIndex];
    if (current === path) return tab;
    const history = [...tab.history.slice(0, tab.historyIndex + 1), path];
    return { ...tab, history, historyIndex: history.length - 1, title: titleFor(tab.kind, path) };
  });
}

export function tabHistoryMovedBack(state: TabsState, tabId: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
    const historyIndex = Math.max(0, tab.historyIndex - 1);
    return { ...tab, historyIndex, title: titleFor(tab.kind, tab.history[historyIndex] ?? '') };
  });
}

export function tabHistoryMovedForward(state: TabsState, tabId: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
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

export function tabPathRestored(state: TabsState, tabId: string, path: string): TabsState {
  return tabUpdated(state, tabId, (tab) => {
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
    && current.path === entry.path
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
  };
}

export function interactionMovedBack(
  state: TabsState,
): { readonly entry: InteractionHistoryEntry | null; readonly state: TabsState; } {
  const sanitized = sanitizeInteractionHistory(state);
  const interactionHistoryIndex = Math.max(0, sanitized.interactionHistoryIndex - 1);
  const entry = sanitized.interactionHistory[interactionHistoryIndex] ?? null;
  return {
    entry,
    state: entry
      ? { ...sanitized, activeTabId: entry.activeTabId, interactionHistoryIndex }
      : sanitized,
  };
}

export function interactionMovedForward(
  state: TabsState,
): { readonly entry: InteractionHistoryEntry | null; readonly state: TabsState; } {
  const sanitized = sanitizeInteractionHistory(state);
  const interactionHistoryIndex = Math.min(
    sanitized.interactionHistory.length - 1,
    sanitized.interactionHistoryIndex + 1,
  );
  const entry = sanitized.interactionHistory[interactionHistoryIndex] ?? null;
  return {
    entry,
    state: entry
      ? { ...sanitized, activeTabId: entry.activeTabId, interactionHistoryIndex }
      : sanitized,
  };
}

export function selectionReset(): SelectionState {
  return initialSelectionState;
}

export function treeItemSelected(state: SelectionState, treeItemId: string | null): SelectionState {
  return { ...state, treeItemId };
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
  return left.title.localeCompare(right.title);
}

function normalizeUniqueTabs(tabs: ReadonlyArray<WorkspaceTab>): ReadonlyArray<WorkspaceTab> {
  const seen = new Set<string>();
  return tabs.map((tab) => {
    const normalized = normalizeWorkspaceTab(tab);
    const id = uniqueTabId(normalized.id, seen);
    seen.add(id);
    return id === normalized.id ? normalized : { ...normalized, id };
  });
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

function sanitizeInteractionHistory(state: TabsState): TabsState {
  const tabIds = tabIdsFor(state.tabs);
  const interactionHistory: InteractionHistoryEntry[] = [];
  let interactionHistoryIndex = -1;
  state.interactionHistory.forEach((entry, index) => {
    if (!tabIds.has(entry.activeTabId)) return;
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
