import { beforeEach, describe, expect, it } from 'vitest';
import { tabTitle } from '../../app-core/workspace/workspaceState.ts';
import type { FirestoreQueryTab } from '../../app-core/workspace/workspaceTypes.ts';
import { activePath, tabActions, tabsStore } from './tabsStore.ts';

describe('tabsStore', () => {
  beforeEach(() => tabActions.reset('emu'));

  it('starts empty when no account is explicit', () => {
    tabActions.reset();

    expect(tabsStore.state).toEqual({
      activeTabId: '',
      interactionHistory: [],
      interactionHistoryIndex: 0,
      selectedTreeItemId: null,
      tabs: [],
    });
  });

  it('opens a Firestore tab with its complete draft in one store update', () => {
    const id = tabActions.openTab({
      kind: 'firestore-query',
      connectionId: 'emu',
      draft: {
        path: 'customers',
        filters: [],
        filterField: '',
        filterOp: '==',
        filterValue: '',
        sortField: 'createdAt',
        sortDirection: 'asc',
        limit: 50,
      },
    });
    const tab = getFirestoreTab(id);

    expect({
      activeTabId: tabsStore.state.activeTabId,
      draft: tab.draft,
      title: tabTitle(tab),
    }).toEqual({
      activeTabId: id,
      draft: expect.objectContaining({
        path: 'customers',
        sortField: 'createdAt',
        sortDirection: 'asc',
        limit: 50,
      }),
      title: 'customers',
    });
  });

  it('reports whether granular draft edits change the effective query', () => {
    const formattingOnly = tabActions.editFirestoreDraft('tab-firestore', {
      type: 'path-set',
      path: '/orders//',
    });
    const changed = tabActions.editFirestoreDraft('tab-firestore', {
      type: 'limit-set',
      limit: 100,
    });

    expect({
      changed,
      draft: getFirestoreTab('tab-firestore').draft,
      formattingOnly,
    }).toEqual({
      changed: true,
      draft: expect.objectContaining({ path: '/orders//', limit: 100 }),
      formattingOnly: false,
    });
  });

  it('preserves an edited tab while opening and reusing collection targets', () => {
    tabActions.editFirestoreDraft('tab-firestore', {
      type: 'path-set',
      path: 'auditLogs',
    });
    tabActions.editFirestoreDraft('tab-firestore', {
      type: 'sort-field-set',
      sortField: 'createdAt',
    });

    const ordersId = tabActions.openFirestoreTarget({
      connectionId: 'emu',
      newTab: false,
      path: 'orders',
    });
    const auditLogsId = tabActions.openFirestoreTarget({
      connectionId: 'emu',
      newTab: false,
      path: '/auditLogs/',
    });

    expect({
      auditLogsId,
      auditSort: getFirestoreTab(auditLogsId).draft.sortField,
      ordersPath: activePath(getFirestoreTab(ordersId)),
      tabCount: tabsStore.state.tabs.length,
    }).toEqual({
      auditLogsId: 'tab-firestore',
      auditSort: 'createdAt',
      ordersPath: 'orders',
      tabCount: 5,
    });
  });

  it('creates a duplicate only for an explicit new-target action', () => {
    const originalCount = tabsStore.state.tabs.length;

    const id = tabActions.openFirestoreTarget({
      connectionId: 'emu',
      newTab: true,
      path: 'orders',
    });

    expect({
      id,
      path: activePath(getFirestoreTab(id)),
      tabCount: tabsStore.state.tabs.length,
    }).toEqual({
      id: 'tab-firestore-query-1',
      path: 'orders',
      tabCount: originalCount + 1,
    });
  });

  it('duplicates canonical Firestore state explicitly', () => {
    tabActions.editFirestoreDraft('tab-firestore', {
      type: 'path-set',
      path: 'customers',
    });
    tabActions.editFirestoreDraft('tab-firestore', {
      type: 'limit-set',
      limit: 75,
    });

    const id = tabActions.duplicateTab('tab-firestore');

    expect(id).toBe('tab-firestore-query-1');
    expect(getFirestoreTab(id!).draft).toEqual(getFirestoreTab('tab-firestore').draft);
  });

  it('restores complete Firestore interaction snapshots through store actions', () => {
    tabActions.editFirestoreDraft('tab-firestore', {
      type: 'path-set',
      path: 'auditLogs',
    });
    tabActions.editFirestoreDraft('tab-firestore', {
      type: 'limit-set',
      limit: 50,
    });
    tabActions.selectTreeItem('collection:emu:auditLogs');
    tabActions.recordInteraction({
      activeTabId: 'tab-firestore',
      selectedTreeItemId: 'collection:emu:auditLogs',
    });
    tabActions.updateConnection('tab-firestore', 'prod');
    tabActions.editFirestoreDraft('tab-firestore', {
      type: 'path-set',
      path: 'customers',
    });
    tabActions.selectTreeItem('collection:prod:customers');

    const back = tabActions.goBackInteraction();
    const backTab = getFirestoreTab('tab-firestore');
    const forward = tabActions.goForwardInteraction();
    const forwardTab = getFirestoreTab('tab-firestore');

    expect({
      backConnection: backTab.connectionId,
      backLimit: backTab.draft.limit,
      backPath: backTab.draft.path,
      backTree: back?.selectedTreeItemId,
      forwardConnection: forwardTab.connectionId,
      forwardPath: forwardTab.draft.path,
      forwardTree: forward?.selectedTreeItemId,
    }).toEqual({
      backConnection: 'emu',
      backLimit: 50,
      backPath: 'auditLogs',
      backTree: 'collection:emu:auditLogs',
      forwardConnection: 'prod',
      forwardPath: 'customers',
      forwardTree: 'collection:prod:customers',
    });
  });

  it('supports tab context close operations and allows an empty workspace', () => {
    const extraId = tabActions.openTab({
      kind: 'firestore-query',
      connectionId: 'prod',
      path: 'customers',
    });
    tabActions.closeTabsToLeft(extraId);
    tabActions.openTab({ kind: 'js-query', connectionId: 'stage' });
    tabActions.closeOtherTabs(extraId);
    tabActions.closeAllTabs();

    expect(tabsStore.state).toMatchObject({
      activeTabId: '',
      interactionHistory: [],
      selectedTreeItemId: null,
      tabs: [],
    });
  });

  it('keeps single-click reuse isolated by account', () => {
    const emuId = tabActions.openFirestoreTarget({
      connectionId: 'emu',
      newTab: false,
      path: 'orders',
    });
    const prodId = tabActions.openFirestoreTarget({
      connectionId: 'prod',
      newTab: false,
      path: 'orders',
    });

    expect({
      emuId,
      prodConnection: getFirestoreTab(prodId).connectionId,
      prodId,
    }).toEqual({
      emuId: 'tab-firestore',
      prodConnection: 'prod',
      prodId: 'tab-firestore-query-2',
    });
  });
});

function getFirestoreTab(tabId: string): FirestoreQueryTab {
  const tab = tabsStore.state.tabs.find((item) => item.id === tabId);
  if (!tab || tab.kind !== 'firestore-query') throw new Error(`Missing Firestore tab ${tabId}`);
  return tab;
}
