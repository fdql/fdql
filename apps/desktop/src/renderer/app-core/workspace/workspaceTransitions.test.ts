import { describe, expect, it } from 'vitest';
import { activePath, createInitialTabsState } from './workspaceState.ts';
import { initialSelectionState } from './workspaceState.ts';
import {
  allTabsClosed,
  authUserSelected,
  interactionMovedBack,
  interactionMovedForward,
  interactionRecorded,
  otherTabsClosed,
  tabClosed,
  tabDuplicated,
  tabHistoryMovedBack,
  tabHistoryMovedForward,
  tabHistoryPushed,
  tabOpened,
  tabOpenedOrSelected,
  tabPathRestored,
  tabsReordered,
  tabsRestored,
  tabsSortedByProject,
  tabsToLeftClosed,
  tabsToRightClosed,
  treeItemSelected,
} from './workspaceTransitions.ts';

describe('workspace transitions', () => {
  it('opens and selects tabs with generated ids supplied by the adapter', () => {
    const result = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'emu', path: 'customers' },
      'tab-firestore-query-1',
    );

    expect(result.tabId).toBe('tab-firestore-query-1');
    expect(result.state.activeTabId).toBe('tab-firestore-query-1');
    expect(result.state.tabs.at(-1)?.title).toBe('customers');
  });

  it('keeps opened tab ids unique when the adapter supplies a stale id', () => {
    const result = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'emu', path: 'customers' },
      'tab-firestore',
    );

    expect(result.tabId).toBe('tab-firestore-2');
    expect(result.state.activeTabId).toBe('tab-firestore-2');
    expect(result.state.tabs.map((tab) => tab.id)).toEqual([
      'tab-firestore',
      'tab-auth',
      'tab-js',
      'tab-sql',
      'tab-firestore-2',
    ]);
  });

  it('selects existing tabs instead of duplicating them', () => {
    const state = createInitialTabsState('emu');

    const result = tabOpenedOrSelected(
      state,
      { kind: 'firestore-query', connectionId: 'emu', path: 'orders' },
      'tab-firestore-query-1',
    );

    expect(result.tabId).toBe('tab-firestore');
    expect(result.state.tabs).toHaveLength(4);
  });

  it('duplicates a tab beside the source and preserves tab state', () => {
    const state = tabHistoryPushed(createInitialTabsState('emu'), 'tab-firestore', 'customers');

    const result = tabDuplicated(state, 'tab-firestore', 'tab-firestore-copy');

    expect(result.tabId).toBe('tab-firestore-copy');
    expect(result.state.activeTabId).toBe('tab-firestore-copy');
    expect(result.state.tabs.map((tab) => tab.id)).toEqual([
      'tab-firestore',
      'tab-firestore-copy',
      'tab-auth',
      'tab-js',
      'tab-sql',
    ]);
    expect(result.state.tabs[1]).toMatchObject({
      connectionId: 'emu',
      history: ['orders', 'customers'],
      historyIndex: 1,
      kind: 'firestore-query',
      title: 'customers',
    });
  });

  it('closes active and bulk tabs predictably', () => {
    const opened = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'js-query', connectionId: 'stage' },
      'tab-js-query-1',
    ).state;

    expect(tabClosed(opened, 'tab-js-query-1').activeTabId).toBe('tab-sql');
    expect(tabsToLeftClosed(opened, 'tab-js-query-1').tabs.map((tab) => tab.id)).toEqual([
      'tab-js-query-1',
    ]);
    expect(tabsToRightClosed(opened, 'tab-firestore').tabs.map((tab) => tab.id)).toEqual([
      'tab-firestore',
    ]);
    expect(otherTabsClosed(opened, 'tab-auth').tabs.map((tab) => tab.id)).toEqual(['tab-auth']);
    expect(allTabsClosed(opened).tabs).toEqual([]);
  });

  it('prunes interaction history for closed tabs', () => {
    const opened = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'prod', path: 'customers' },
      'tab-firestore-query-1',
    ).state;
    const state = interactionRecorded(
      interactionRecorded(opened, {
        activeTabId: 'tab-firestore',
        path: 'orders',
        selectedTreeItemId: 'collection:emu:orders',
      }),
      {
        activeTabId: 'tab-firestore-query-1',
        path: 'customers',
        selectedTreeItemId: 'collection:prod:customers',
      },
    );

    const closed = tabClosed(state, 'tab-firestore-query-1');

    expect(closed.activeTabId).toBe('tab-sql');
    expect(closed.interactionHistory.map((entry) => entry.activeTabId)).toEqual([
      'tab-firestore',
      'tab-firestore',
    ]);
    expect(closed.interactionHistory).not.toContainEqual(
      expect.objectContaining({ activeTabId: 'tab-firestore-query-1' }),
    );
    expect(closed.interactionHistoryIndex).toBe(1);
  });

  it('prunes interaction history for bulk close operations', () => {
    const opened = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'prod', path: 'customers' },
      'tab-firestore-query-1',
    ).state;
    const state = interactionRecorded(
      interactionRecorded(opened, {
        activeTabId: 'tab-firestore',
        path: 'orders',
        selectedTreeItemId: 'collection:emu:orders',
      }),
      {
        activeTabId: 'tab-firestore-query-1',
        path: 'customers',
        selectedTreeItemId: 'collection:prod:customers',
      },
    );

    expect(otherTabsClosed(state, 'tab-firestore').interactionHistory).not.toContainEqual(
      expect.objectContaining({ activeTabId: 'tab-firestore-query-1' }),
    );
    expect(tabsToLeftClosed(state, 'tab-firestore-query-1').interactionHistory).toEqual([
      {
        activeTabId: 'tab-firestore-query-1',
        path: 'customers',
        selectedTreeItemId: 'collection:prod:customers',
      },
    ]);
    expect(tabsToRightClosed(state, 'tab-firestore').interactionHistory).not.toContainEqual(
      expect.objectContaining({ activeTabId: 'tab-firestore-query-1' }),
    );
  });

  it('reorders and sorts tabs by account', () => {
    const state = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'prod', path: 'customers' },
      'tab-firestore-query-1',
    ).state;

    expect(tabsReordered(state, 'tab-js', 'tab-firestore').tabs[0]?.id).toBe('tab-js');
    expect(tabsSortedByProject(state).tabs.map((tab) => tab.connectionId)).toEqual([
      'emu',
      'emu',
      'emu',
      'emu',
      'prod',
    ]);
  });

  it('tracks tab history and path restoration', () => {
    const pushed = tabHistoryPushed(
      tabHistoryPushed(createInitialTabsState('emu'), 'tab-firestore', 'customers'),
      'tab-firestore',
      'featureFlags',
    );

    const back = tabHistoryMovedBack(pushed, 'tab-firestore');
    expect(activePath(back.tabs.find((tab) => tab.id === 'tab-firestore')!)).toBe('customers');

    const forward = tabHistoryMovedForward(back, 'tab-firestore');
    expect(activePath(forward.tabs.find((tab) => tab.id === 'tab-firestore')!)).toBe(
      'featureFlags',
    );

    const restored = tabPathRestored(forward, 'tab-firestore', 'orders');
    expect(activePath(restored.tabs.find((tab) => tab.id === 'tab-firestore')!)).toBe('orders');
  });

  it('replays interaction history without changing open tabs', () => {
    const state = interactionRecorded(
      interactionRecorded(createInitialTabsState('emu'), {
        activeTabId: 'tab-firestore',
        path: 'orders',
        selectedTreeItemId: 'collection:emu:orders',
      }),
      {
        activeTabId: 'tab-auth',
        path: 'auth/users',
        selectedTreeItemId: 'auth:emu',
      },
    );

    const result = interactionMovedBack(state);

    expect(result.entry).toEqual({
      activeTabId: 'tab-firestore',
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
    expect(result.state.tabs).toHaveLength(4);
  });

  it('skips stale closed-tab entries when replaying interaction history', () => {
    const state = {
      ...createInitialTabsState('emu'),
      activeTabId: 'tab-firestore',
      interactionHistory: [
        {
          activeTabId: 'tab-firestore',
          path: 'orders',
          selectedTreeItemId: 'collection:emu:orders',
        },
        {
          activeTabId: 'closed-tab',
          path: 'closed',
          selectedTreeItemId: 'collection:emu:closed',
        },
        {
          activeTabId: 'tab-auth',
          path: 'auth/users',
          selectedTreeItemId: 'auth:emu',
        },
      ],
      interactionHistoryIndex: 0,
    };

    const forward = interactionMovedForward(state);
    const back = interactionMovedBack(forward.state);

    expect(forward.entry).toEqual({
      activeTabId: 'tab-auth',
      path: 'auth/users',
      selectedTreeItemId: 'auth:emu',
    });
    expect(forward.state.activeTabId).toBe('tab-auth');
    expect(forward.state.interactionHistory).toHaveLength(2);
    expect(back.entry).toEqual({
      activeTabId: 'tab-firestore',
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
    expect(back.state.activeTabId).toBe('tab-firestore');
  });

  it('normalizes restored tabs and interaction history', () => {
    const restored = tabsRestored({
      activeTabId: 'missing',
      interactionHistory: [
        { activeTabId: 'tab-one', selectedTreeItemId: null },
        { activeTabId: 'missing', selectedTreeItemId: null },
      ],
      interactionHistoryIndex: 99,
      tabs: [{
        connectionId: 'emu',
        history: [],
        historyIndex: 99,
        id: 'tab-one',
        inspectorWidth: Number.NaN,
        kind: 'firestore-query',
        title: 'stale',
      }],
    });

    expect(restored.activeTabId).toBe('tab-one');
    expect(restored.interactionHistory).toHaveLength(1);
    expect(restored.tabs[0]).toMatchObject({
      history: ['orders'],
      historyIndex: 0,
      inspectorWidth: 360,
      title: 'orders',
    });
  });

  it('renames duplicate restored tab ids so only one tab can match active state', () => {
    const restored = tabsRestored({
      activeTabId: 'tab-firestore',
      interactionHistory: [
        { activeTabId: 'tab-firestore', path: 'orders', selectedTreeItemId: null },
      ],
      interactionHistoryIndex: 0,
      tabs: [
        {
          connectionId: 'emu',
          history: ['orders'],
          historyIndex: 0,
          id: 'tab-firestore',
          inspectorWidth: 360,
          kind: 'firestore-query',
          title: 'orders',
        },
        {
          connectionId: 'emu',
          history: ['admin-leagues'],
          historyIndex: 0,
          id: 'tab-firestore',
          inspectorWidth: 360,
          kind: 'firestore-query',
          title: 'admin-leagues',
        },
      ],
    });

    expect(restored.activeTabId).toBe('tab-firestore');
    expect(restored.tabs.map((tab) => tab.id)).toEqual(['tab-firestore', 'tab-firestore-2']);
    expect(restored.tabs.filter((tab) => tab.id === restored.activeTabId)).toHaveLength(1);
  });

  it('tracks selection slices independently', () => {
    const state = authUserSelected(
      treeItemSelected(initialSelectionState, 'collection:emu:orders'),
      'u_ada',
    );

    expect(state).toEqual({
      authUserId: 'u_ada',
      treeItemId: 'collection:emu:orders',
    });
  });
});
