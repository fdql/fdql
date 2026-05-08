import { Store } from '@tanstack/react-store';
import { activePath, createEmptyTabsState } from '../../app-core/workspace/workspaceState.ts';
import {
  allTabsClosed,
  findOpenWorkspaceTab,
  interactionMovedBack,
  interactionMovedForward,
  interactionRecorded,
  otherTabsClosed,
  tabClosed,
  tabConnectionUpdated,
  tabCounterFor,
  tabDuplicated,
  tabHistoryMovedBack,
  tabHistoryMovedForward,
  tabHistoryPushed,
  tabInspectorWidthChanged,
  tabOpened,
  tabPathRestored,
  tabSelected,
  tabsReordered,
  tabsReset,
  tabsRestored,
  tabsSortedByProject,
  tabsToLeftClosed,
  tabsToRightClosed,
} from '../../app-core/workspace/workspaceTransitions.ts';
import {
  type InteractionHistoryEntry,
  type OpenTabInput,
  type TabsState,
  WORKSPACE_TAB_KINDS,
  type WorkspaceTab,
  type WorkspaceTabKind,
} from '../../app-core/workspace/workspaceTypes.ts';

export {
  activePath,
  type InteractionHistoryEntry,
  type OpenTabInput,
  type TabsState,
  WORKSPACE_TAB_KINDS,
  type WorkspaceTab,
  type WorkspaceTabKind,
};

let tabCounter = 0;

export const tabsStore = new Store<TabsState>(createEmptyTabsState());

export const tabActions = {
  reset(connectionId?: string) {
    tabCounter = 0;
    tabsStore.setState(() => tabsReset(connectionId));
  },
  restore(state: TabsState) {
    const next = tabsRestored(state);
    tabsStore.setState(() => next);
    tabCounter = Math.max(tabCounter, ...next.tabs.map(tabCounterFor), 0);
  },
  openTab(input: OpenTabInput): string {
    const result = tabOpened(tabsStore.state, input, nextTabId(input.kind));
    tabsStore.setState(() => result.state);
    return result.tabId;
  },
  openOrSelectTab(input: OpenTabInput): string {
    const existing = findOpenWorkspaceTab(tabsStore.state, input);
    const result = existing
      ? { state: tabSelected(tabsStore.state, existing.id), tabId: existing.id }
      : tabOpened(tabsStore.state, input, nextTabId(input.kind));
    tabsStore.setState(() => result.state);
    return result.tabId;
  },
  duplicateTab(tabId: string): string | null {
    const source = tabsStore.state.tabs.find((tab) => tab.id === tabId);
    if (!source) return null;
    const result = tabDuplicated(tabsStore.state, tabId, nextTabId(source.kind));
    tabsStore.setState(() => result.state);
    return result.tabId;
  },
  selectTab(tabId: string) {
    tabsStore.setState((state) => tabSelected(state, tabId));
  },
  closeTab(tabId: string) {
    tabsStore.setState((state) => tabClosed(state, tabId));
  },
  closeOtherTabs(tabId: string) {
    tabsStore.setState((state) => otherTabsClosed(state, tabId));
  },
  closeTabsToLeft(tabId: string) {
    tabsStore.setState((state) => tabsToLeftClosed(state, tabId));
  },
  closeTabsToRight(tabId: string) {
    tabsStore.setState((state) => tabsToRightClosed(state, tabId));
  },
  closeAllTabs() {
    tabsStore.setState((state) => allTabsClosed(state));
  },
  reorderTabs(activeId: string, overId: string) {
    tabsStore.setState((state) => tabsReordered(state, activeId, overId));
  },
  sortByProject() {
    tabsStore.setState((state) => tabsSortedByProject(state));
  },
  updateConnection(tabId: string, connectionId: string) {
    tabsStore.setState((state) => tabConnectionUpdated(state, tabId, connectionId));
  },
  pushHistory(tabId: string, path: string) {
    tabsStore.setState((state) => tabHistoryPushed(state, tabId, path));
  },
  goBack(tabId: string) {
    tabsStore.setState((state) => tabHistoryMovedBack(state, tabId));
  },
  goForward(tabId: string) {
    tabsStore.setState((state) => tabHistoryMovedForward(state, tabId));
  },
  setInspectorWidth(tabId: string, inspectorWidth: number) {
    tabsStore.setState((state) => tabInspectorWidthChanged(state, tabId, inspectorWidth));
  },
  restorePath(tabId: string, path: string) {
    tabsStore.setState((state) => tabPathRestored(state, tabId, path));
  },
  recordInteraction(entry: InteractionHistoryEntry) {
    tabsStore.setState((state) => interactionRecorded(state, entry));
  },
  goBackInteraction(): InteractionHistoryEntry | null {
    let entry: InteractionHistoryEntry | null = null;
    tabsStore.setState((state) => {
      const result = interactionMovedBack(state);
      entry = result.entry;
      return result.state;
    });
    return entry;
  },
  goForwardInteraction(): InteractionHistoryEntry | null {
    let entry: InteractionHistoryEntry | null = null;
    tabsStore.setState((state) => {
      const result = interactionMovedForward(state);
      entry = result.entry;
      return result.state;
    });
    return entry;
  },
};

function nextTabId(kind: WorkspaceTabKind): string {
  tabCounter += 1;
  return `tab-${kind}-${tabCounter}`;
}
