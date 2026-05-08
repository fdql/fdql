import { beforeEach, describe, expect, it } from 'vitest';
import { activePath, tabActions, tabsStore } from './tabsStore.ts';

describe('tabsStore', () => {
  beforeEach(() => tabActions.reset('emu'));

  it('starts empty when no account is explicit', () => {
    tabActions.reset();
    expect(tabsStore.state).toEqual({
      activeTabId: '',
      interactionHistory: [],
      interactionHistoryIndex: 0,
      tabs: [],
    });
  });

  it('opens and selects session-only tabs', () => {
    const id = tabActions.openTab({
      kind: 'firestore-query',
      connectionId: 'emu',
      path: 'customers',
    });
    const state = tabsStore.state;
    expect(state.activeTabId).toBe(id);
    expect(state.tabs.at(-1)?.title).toBe('customers');
  });

  it('allows closing every tab', () => {
    tabActions.closeTab('tab-firestore');
    tabActions.closeTab('tab-auth');
    tabActions.closeTab('tab-js');
    tabActions.closeTab('tab-sql');
    expect(tabsStore.state.tabs).toHaveLength(0);
    expect(tabsStore.state.activeTabId).toBe('');
  });

  it('close all leaves no tabs open', () => {
    tabActions.closeAllTabs();
    expect(tabsStore.state.tabs).toHaveLength(0);
    expect(tabsStore.state.activeTabId).toBe('');
    expect(tabsStore.state.interactionHistory).toHaveLength(0);
  });

  it('reorders tabs and preserves active tab', () => {
    tabActions.selectTab('tab-js');
    tabActions.reorderTabs('tab-js', 'tab-firestore');
    expect(tabsStore.state.tabs[0]?.id).toBe('tab-js');
    expect(tabsStore.state.activeTabId).toBe('tab-js');
  });

  it('tracks per-tab path history', () => {
    tabActions.pushHistory('tab-firestore', 'customers');
    tabActions.pushHistory('tab-firestore', 'featureFlags');
    tabActions.goBack('tab-firestore');
    const tab = tabsStore.state.tabs.find((item) => item.id === 'tab-firestore')!;
    expect(activePath(tab)).toBe('customers');
    tabActions.goForward('tab-firestore');
    expect(activePath(tabsStore.state.tabs.find((item) => item.id === 'tab-firestore')!)).toBe(
      'featureFlags',
    );
  });

  it('selects an existing connection-bound tab instead of duplicating it', () => {
    const firstId = tabActions.openOrSelectTab({
      kind: 'firestore-query',
      connectionId: 'emu',
      path: 'orders',
    });
    const secondId = tabActions.openOrSelectTab({
      kind: 'firestore-query',
      connectionId: 'emu',
      path: 'orders',
    });
    expect(firstId).toBe('tab-firestore');
    expect(secondId).toBe(firstId);
    expect(tabsStore.state.tabs.filter((tab) => activePath(tab) === 'orders')).toHaveLength(1);
  });

  it('duplicates a tab explicitly', () => {
    tabActions.pushHistory('tab-firestore', 'customers');

    const id = tabActions.duplicateTab('tab-firestore');

    expect(id).toBe('tab-firestore-query-1');
    expect(tabsStore.state.activeTabId).toBe(id);
    expect(activePath(tabsStore.state.tabs[1]!)).toBe('customers');
  });

  it('supports tab context bulk operations', () => {
    const extraId = tabActions.openTab({
      kind: 'firestore-query',
      connectionId: 'prod',
      path: 'customers',
    });
    tabActions.closeTabsToLeft(extraId);
    expect(tabsStore.state.tabs[0]?.id).toBe(extraId);
    tabActions.openTab({ kind: 'js-query', connectionId: 'stage' });
    tabActions.closeOtherTabs(extraId);
    expect(tabsStore.state.tabs.map((tab) => tab.id)).toEqual([extraId]);
  });

  it('replays global interaction history without opening tabs', () => {
    const customersId = tabActions.openTab({
      kind: 'firestore-query',
      connectionId: 'emu',
      path: 'customers',
    });
    tabActions.recordInteraction({
      activeTabId: 'tab-firestore',
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
    tabActions.recordInteraction({
      activeTabId: customersId,
      path: 'customers',
      selectedTreeItemId: 'collection:emu:customers',
    });
    const entry = tabActions.goBackInteraction();
    expect(entry).toEqual({
      activeTabId: 'tab-firestore',
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
    expect(tabsStore.state.tabs).toHaveLength(5);
  });
});
