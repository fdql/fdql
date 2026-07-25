import { describe, expect, it } from 'vitest';
import { closeWorkspaceTabsCommand, restoreWorkspaceTabsCommand } from './workspaceCommands.ts';
import { createInitialTabsState } from './workspaceState.ts';
import { tabOpened } from './workspaceTransitions.ts';

describe('workspace commands', () => {
  it('closes only non-busy tabs and reports kept busy tabs', () => {
    const state = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'emu', path: 'customers' },
      'tab-firestore-query-1',
    ).state;

    const busy = state.tabs.find((tab) => tab.id === 'tab-auth')!;
    const result = closeWorkspaceTabsCommand(state, {
      busyTabIds: new Set([busy.id]),
      successLabel: 'Closed selected tabs',
      tabsToClose: [state.tabs[0]!, busy],
    });

    expect(result.tabsToCleanup.map((tab) => tab.id)).toEqual(['tab-firestore']);
    expect(result.state.tabs.map((tab) => tab.id)).not.toContain('tab-firestore');
    expect(result.state.tabs.map((tab) => tab.id)).toContain('tab-auth');
    expect(result.lastAction).toBe('Closed selected tabs; kept 1 busy tab');
  });

  it('keeps state unchanged when every requested tab is busy', () => {
    const state = createInitialTabsState('emu');
    const result = closeWorkspaceTabsCommand(state, {
      busyTabIds: new Set(['tab-firestore']),
      successLabel: 'Closed tab',
      tabsToClose: [state.tabs[0]!],
    });

    expect(result.state).toBe(state);
    expect(result.tabsToCleanup).toEqual([]);
    expect(result.lastAction).toBe('Still loading orders');
  });

  it('clears interaction history when all open tabs close', () => {
    const state = createInitialTabsState('emu');
    const result = closeWorkspaceTabsCommand(state, {
      busyTabIds: new Set(),
      successLabel: 'Closed all tabs',
      tabsToClose: state.tabs,
    });

    expect(result.state.tabs).toEqual([]);
    expect(result.state.interactionHistory).toEqual([]);
    expect(result.lastAction).toBe('Closed all tabs');
  });

  it('restores tabs, drops closed interaction history, and returns active tab', () => {
    const state = createInitialTabsState('emu');
    const result = restoreWorkspaceTabsCommand({
      ...state,
      activeTabId: 'tab-js',
      interactionHistory: [
        ...state.interactionHistory,
        {
          activeTabId: 'missing-tab',
          location: {
            kind: 'firestore-query',
            connectionId: 'emu',
            draft: {
              path: 'missing',
              filters: [],
              filterField: '',
              filterOp: '==',
              filterValue: '',
              sortField: '',
              sortDirection: 'desc',
              limit: 25,
            },
          },
          selectedTreeItemId: 'collection:emu:missing',
        },
      ],
      interactionHistoryIndex: 1,
    });

    expect(result.activeTab?.id).toBe('tab-js');
    expect(result.state.interactionHistory).toHaveLength(1);
    expect(result.state.interactionHistoryIndex).toBe(0);
  });
});
