import { tabTitle } from './workspaceState.ts';
import { allTabsClosed, tabClosed, tabsRestored } from './workspaceTransitions.ts';
import type { TabsState, WorkspaceTab } from './workspaceTypes.ts';

export interface CloseWorkspaceTabsCommandInput {
  readonly busyTabIds: ReadonlySet<string>;
  readonly successLabel: string;
  readonly tabsToClose: ReadonlyArray<WorkspaceTab>;
}

export interface CloseWorkspaceTabsCommandResult {
  readonly lastAction: string;
  readonly state: TabsState;
  readonly tabsToCleanup: ReadonlyArray<WorkspaceTab>;
}

export interface RestoreWorkspaceTabsCommandResult {
  readonly activeTab: WorkspaceTab | null;
  readonly state: TabsState;
}

export function closeWorkspaceTabsCommand(
  state: TabsState,
  input: CloseWorkspaceTabsCommandInput,
): CloseWorkspaceTabsCommandResult {
  const blockedTabs = input.tabsToClose.filter((tab) => input.busyTabIds.has(tab.id));
  const blockedIds = new Set(blockedTabs.map((tab) => tab.id));
  const tabsToCleanup = input.tabsToClose.filter((tab) => !blockedIds.has(tab.id));

  if (!tabsToCleanup.length) {
    return {
      lastAction: blockedTabs[0]
        ? `Still loading ${tabTitle(blockedTabs[0])}`
        : 'Still loading tab',
      state,
      tabsToCleanup,
    };
  }

  const nextState = closesEveryOpenTab(state, tabsToCleanup)
    ? allTabsClosed(state)
    : tabsToCleanup.reduce((current, tab) => tabClosed(current, tab.id), state);

  return {
    lastAction: blockedTabs.length
      ? `${input.successLabel}; kept ${blockedTabs.length} busy tab${
        blockedTabs.length === 1 ? '' : 's'
      }`
      : input.successLabel,
    state: nextState,
    tabsToCleanup,
  };
}

export function restoreWorkspaceTabsCommand(state: TabsState): RestoreWorkspaceTabsCommandResult {
  const restored = tabsRestored(state);
  return {
    activeTab: restored.tabs.find((tab) => tab.id === restored.activeTabId) ?? restored.tabs[0]
      ?? null,
    state: restored,
  };
}

function closesEveryOpenTab(
  state: TabsState,
  tabsToCleanup: ReadonlyArray<WorkspaceTab>,
): boolean {
  if (state.tabs.length !== tabsToCleanup.length) return false;
  const ids = new Set(tabsToCleanup.map((tab) => tab.id));
  return state.tabs.every((tab) => ids.has(tab.id));
}
