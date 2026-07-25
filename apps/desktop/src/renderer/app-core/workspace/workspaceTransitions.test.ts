import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import { describe, expect, it } from 'vitest';
import {
  createFirestoreDraft,
  DEFAULT_FIRESTORE_DRAFT,
} from '../firestore/query/firestoreQueryDraft.ts';
import {
  activePath,
  createInitialTabsState,
  initialSelectionState,
  interactionLocationForTab,
  tabTitle,
} from './workspaceState.ts';
import {
  allTabsClosed,
  authUserSelected,
  findOpenWorkspaceTab,
  firestoreTabDraftEdited,
  firestoreTabInspectorUiChanged,
  interactionMovedBack,
  interactionMovedForward,
  interactionRecorded,
  openFirestoreTarget,
  otherTabsClosed,
  tabClosed,
  tabConnectionUpdated,
  tabDuplicated,
  tabHistoryMovedBack,
  tabHistoryMovedForward,
  tabHistoryPushed,
  tabOpened,
  tabOpenedOrSelected,
  tabPathRestored,
  tabSelected,
  tabsReordered,
  tabsRestored,
  tabsSortedByProject,
  tabsToLeftClosed,
  tabsToRightClosed,
  workspaceTreeItemSelected,
} from './workspaceTransitions.ts';
import type { FirestoreQueryTab, InteractionHistoryEntry, TabsState } from './workspaceTypes.ts';

describe('workspace transitions', () => {
  it('opens a Firestore tab atomically with its canonical draft and derived title', () => {
    const draft = queryDraft('/customers//', { limit: 50, sortField: 'createdAt' });

    const result = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'emu', draft },
      'tab-firestore-query-1',
    );
    const tab = getFirestoreTab(result.state, result.tabId);

    expect({
      activeTabId: result.state.activeTabId,
      draft: tab.draft,
      hasStoredTitle: 'title' in tab,
      title: tabTitle(tab),
    }).toEqual({
      activeTabId: 'tab-firestore-query-1',
      draft,
      hasStoredTitle: false,
      title: 'customers',
    });
  });

  it('keeps opened tab ids unique when the adapter supplies a stale id', () => {
    const result = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'emu', path: 'customers' },
      'tab-firestore',
    );

    expect(result.tabId).toBe('tab-firestore-2');
    expect(result.state.tabs.map((tab) => tab.id)).toEqual([
      'tab-firestore',
      'tab-auth',
      'tab-js',
      'tab-sql',
      'tab-firestore-2',
    ]);
  });

  it('matches Firestore tabs by normalized path within the requested account', () => {
    const state = createInitialTabsState('emu');

    expect(
      findOpenWorkspaceTab(state, {
        kind: 'firestore-query',
        connectionId: 'emu',
        path: '/orders//',
      })?.id,
    ).toBe('tab-firestore');
    expect(findOpenWorkspaceTab(state, {
      kind: 'firestore-query',
      connectionId: 'prod',
      path: '/orders//',
    })).toBeUndefined();
    expect(findOpenWorkspaceTab(state, {
      kind: 'firestore-query',
      connectionId: 'emu',
      path: '///',
    })).toBeUndefined();
  });

  it('preserves an edited tab when another collection opens and reuses it later', () => {
    let state = createInitialTabsState('emu');
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'path-set',
      path: 'auditLogs',
    }).state;
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'limit-set',
      limit: 100,
    }).state;

    const orders = openFirestoreTarget(state, {
      connectionId: 'emu',
      newTab: false,
      path: 'orders',
    }, 'tab-orders');
    const auditLogs = openFirestoreTarget(orders.state, {
      connectionId: 'emu',
      newTab: false,
      path: '/auditLogs/',
    }, 'unused-id');

    expect({
      auditLogsId: auditLogs.tabId,
      auditLogsLimit: getFirestoreTab(auditLogs.state, auditLogs.tabId).draft.limit,
      ordersId: orders.tabId,
      tabCount: auditLogs.state.tabs.length,
    }).toEqual({
      auditLogsId: 'tab-firestore',
      auditLogsLimit: 100,
      ordersId: 'tab-orders',
      tabCount: 5,
    });
  });

  it('reuses the most recently activated duplicate when the active tab does not match', () => {
    const duplicate = tabDuplicated(
      createInitialTabsState('emu'),
      'tab-firestore',
      'tab-orders-copy',
    );
    const customers = tabOpened(
      duplicate.state,
      { kind: 'firestore-query', connectionId: 'emu', path: 'customers' },
      'tab-customers',
    );

    const result = tabOpenedOrSelected(
      customers.state,
      { kind: 'firestore-query', connectionId: 'emu', path: 'orders' },
      'unused-id',
    );

    expect(result.tabId).toBe('tab-orders-copy');
    expect(result.state.tabs).toHaveLength(6);
  });

  it('an explicit new Firestore target action creates exactly one complete tab', () => {
    const state = createInitialTabsState('emu');

    const result = openFirestoreTarget(state, {
      connectionId: 'emu',
      draft: queryDraft('orders', { limit: 75 }),
      newTab: true,
      path: 'orders',
    }, 'tab-explicit-orders');

    expect({
      createdId: result.tabId,
      draft: getFirestoreTab(result.state, result.tabId).draft,
      tabCount: result.state.tabs.length,
    }).toEqual({
      createdId: 'tab-explicit-orders',
      draft: queryDraft('orders', { limit: 75 }),
      tabCount: state.tabs.length + 1,
    });
  });

  it('duplicates editable draft and durable view preferences beside the source', () => {
    let state = firestoreTabDraftEdited(createInitialTabsState('emu'), 'tab-firestore', {
      type: 'filter-add',
      filter: { id: 'paid', field: 'status', op: '==', value: '"paid"' },
    }).state;
    const source = getFirestoreTab(state, 'tab-firestore');
    state = firestoreTabInspectorUiChanged(state, source.id, {
      ...source.inspectorUi,
      resultView: 'json',
    });

    const result = tabDuplicated(state, source.id, 'tab-firestore-copy');
    const copy = getFirestoreTab(result.state, 'tab-firestore-copy');

    expect({
      draft: copy.draft,
      inspectorWidth: copy.inspectorWidth,
      resultView: copy.inspectorUi.resultView,
      strip: result.state.tabs.slice(0, 2).map((tab) => tab.id),
    }).toEqual({
      draft: getFirestoreTab(state, source.id).draft,
      inspectorWidth: source.inspectorWidth,
      resultView: 'json',
      strip: ['tab-firestore', 'tab-firestore-copy'],
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
    expect(allTabsClosed(opened)).toMatchObject({
      activeTabId: '',
      interactionHistory: [],
      selectedTreeItemId: null,
      tabs: [],
    });
  });

  it('prunes interaction history for closed tabs', () => {
    const opened = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'prod', path: 'customers' },
      'tab-customers',
    ).state;
    const customerTab = getFirestoreTab(opened, 'tab-customers');
    const state = interactionRecorded(
      opened,
      interactionEntry(
        customerTab,
        'collection:prod:customers',
      ),
    );

    const closed = tabClosed(state, customerTab.id);

    expect(closed.interactionHistory).not.toContainEqual(
      expect.objectContaining({ activeTabId: customerTab.id }),
    );
    expect(
      closed.interactionHistory.every((entry) =>
        closed.tabs.some((tab) => tab.id === entry.activeTabId)
      ),
    ).toBe(true);
  });

  it('keeps tool-local path history separate from Firestore interaction history', () => {
    const pushed = tabHistoryPushed(
      tabHistoryPushed(createInitialTabsState('emu'), 'tab-js', 'scripts/customers'),
      'tab-js',
      'scripts/featureFlags',
    );

    const back = tabHistoryMovedBack(pushed, 'tab-js');
    const forward = tabHistoryMovedForward(back, 'tab-js');
    const restored = tabPathRestored(forward, 'tab-js', 'scripts/default');

    expect({
      back: activePath(back.tabs.find((tab) => tab.id === 'tab-js')!),
      forward: activePath(forward.tabs.find((tab) => tab.id === 'tab-js')!),
      restored: activePath(restored.tabs.find((tab) => tab.id === 'tab-js')!),
    }).toEqual({
      back: 'scripts/customers',
      forward: 'scripts/featureFlags',
      restored: 'scripts/default',
    });
  });

  it('restores account, full Firestore draft, and tree selection through Back and Forward', () => {
    let state = createInitialTabsState('emu');
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'path-set',
      path: 'auditLogs',
    }).state;
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'filter-add',
      filter: { id: 'severity', field: 'severity', op: '>=', value: '3' },
    }).state;
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'sort-field-set',
      sortField: 'createdAt',
    }).state;
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'sort-direction-set',
      sortDirection: 'asc',
    }).state;
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'limit-set',
      limit: 50,
    }).state;
    state = workspaceTreeItemSelected(state, 'collection:emu:auditLogs');
    const auditTab = getFirestoreTab(state, 'tab-firestore');
    state = interactionRecorded(
      state,
      interactionEntry(
        auditTab,
        'collection:emu:auditLogs',
      ),
    );

    state = tabConnectionUpdated(state, auditTab.id, 'prod');
    state = firestoreTabDraftEdited(state, auditTab.id, {
      type: 'path-set',
      path: 'customers',
    }).state;
    state = firestoreTabDraftEdited(state, auditTab.id, { type: 'reset' }).state;
    state = firestoreTabDraftEdited(state, auditTab.id, {
      type: 'limit-set',
      limit: 100,
    }).state;
    state = workspaceTreeItemSelected(state, 'collection:prod:customers');

    const back = interactionMovedBack(state);
    const backTab = getFirestoreTab(back.state, auditTab.id);
    const forward = interactionMovedForward(back.state);
    const forwardTab = getFirestoreTab(forward.state, auditTab.id);

    expect({
      connectionId: backTab.connectionId,
      draft: backTab.draft,
      selectedTreeItemId: back.state.selectedTreeItemId,
    }).toEqual({
      connectionId: 'emu',
      draft: queryDraft('auditLogs', {
        filters: [{ id: 'severity', field: 'severity', op: '>=', value: '3' }],
        filterField: 'severity',
        filterOp: '>=',
        filterValue: '3',
        limit: 50,
        sortDirection: 'asc',
        sortField: 'createdAt',
      }),
      selectedTreeItemId: 'collection:emu:auditLogs',
    });
    expect({
      connectionId: forwardTab.connectionId,
      draft: forwardTab.draft,
      selectedTreeItemId: forward.state.selectedTreeItemId,
    }).toEqual({
      connectionId: 'prod',
      draft: queryDraft('customers', { limit: 100 }),
      selectedTreeItemId: 'collection:prod:customers',
    });
  });

  it('preserves Forward entries after moving Back', () => {
    let state = createInitialTabsState('emu');
    state = tabSelected(state, 'tab-auth');
    state = workspaceTreeItemSelected(state, 'auth:emu');
    state = tabSelected(state, 'tab-js');
    state = workspaceTreeItemSelected(state, 'script:emu');

    const back = interactionMovedBack(state);
    const forward = interactionMovedForward(back.state);

    expect({
      back: back.entry?.activeTabId,
      forward: forward.entry?.activeTabId,
      historyLength: forward.state.interactionHistory.length,
    }).toEqual({
      back: 'tab-auth',
      forward: 'tab-js',
      historyLength: 3,
    });
  });

  it('skips history entries for closed tabs and removed accounts', () => {
    const state: TabsState = {
      ...createInitialTabsState('emu'),
      activeTabId: 'tab-firestore',
      selectedTreeItemId: 'collection:emu:orders',
      interactionHistory: [
        firestoreEntry('tab-firestore', 'emu', 'orders'),
        firestoreEntry('closed-tab', 'emu', 'closed'),
        {
          activeTabId: 'tab-auth',
          location: { kind: 'tool', connectionId: 'removed', path: 'auth/users' },
          selectedTreeItemId: 'auth:removed',
        },
        {
          activeTabId: 'tab-js',
          location: { kind: 'tool', connectionId: 'emu', path: 'scripts/default' },
          selectedTreeItemId: 'script:emu',
        },
      ],
      interactionHistoryIndex: 0,
    };

    const forward = interactionMovedForward(state, new Set(['emu']));

    expect(forward.entry?.activeTabId).toBe('tab-js');
    expect(forward.state.interactionHistory.map((entry) => entry.activeTabId)).toEqual([
      'tab-firestore',
      'tab-js',
    ]);
  });

  it('reset preserves the raw target path and connection changes preserve the draft', () => {
    let state = createInitialTabsState('emu');
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'path-set',
      path: '/auditLogs//',
    }).state;
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'filter-add',
      filter: { id: 'actor', field: 'actor', op: '==', value: '"ada"' },
    }).state;
    const reset = firestoreTabDraftEdited(state, 'tab-firestore', { type: 'reset' });
    const changedAccount = tabConnectionUpdated(reset.state, 'tab-firestore', 'prod');

    expect({
      connectionId: getFirestoreTab(changedAccount, 'tab-firestore').connectionId,
      draft: getFirestoreTab(changedAccount, 'tab-firestore').draft,
      queryChanged: reset.queryChanged,
      title: tabTitle(getFirestoreTab(changedAccount, 'tab-firestore')),
    }).toEqual({
      connectionId: 'prod',
      draft: queryDraft('/auditLogs//'),
      queryChanged: true,
      title: 'auditLogs',
    });
  });

  it('keeps raw formatting edits without reporting an effective query change', () => {
    const result = firestoreTabDraftEdited(createInitialTabsState('emu'), 'tab-firestore', {
      type: 'path-set',
      path: '/orders//',
    });

    expect({
      path: getFirestoreTab(result.state, 'tab-firestore').draft.path,
      queryChanged: result.queryChanged,
    }).toEqual({ path: '/orders//', queryChanged: false });
  });

  it('ignores controls that do not change the effective repository query', () => {
    const initial = createInitialTabsState('emu');
    const blankFilter = firestoreTabDraftEdited(initial, 'tab-firestore', {
      type: 'filter-add',
      filter: { id: 'blank', field: '', op: '==', value: '' },
    });
    const directionWithoutSort = firestoreTabDraftEdited(initial, 'tab-firestore', {
      type: 'sort-direction-set',
      sortDirection: 'asc',
    });
    const document = firestoreTabDraftEdited(initial, 'tab-firestore', {
      type: 'path-set',
      path: 'orders/ord_1',
    }).state;
    const documentLimit = firestoreTabDraftEdited(document, 'tab-firestore', {
      type: 'limit-set',
      limit: 100,
    });

    expect({
      blankFilter: blankFilter.queryChanged,
      directionWithoutSort: directionWithoutSort.queryChanged,
      documentLimit: documentLimit.queryChanged,
    }).toEqual({
      blankFilter: false,
      directionWithoutSort: false,
      documentLimit: false,
    });
  });

  it('reorders and sorts tabs by account and canonical title', () => {
    let state = tabOpened(
      createInitialTabsState('emu'),
      { kind: 'firestore-query', connectionId: 'prod', path: 'customers' },
      'tab-customers',
    ).state;
    state = firestoreTabDraftEdited(state, 'tab-firestore', {
      type: 'path-set',
      path: 'z-orders',
    }).state;

    expect(tabsReordered(state, 'tab-js', 'tab-firestore').tabs[0]?.id).toBe('tab-js');
    expect(tabsSortedByProject(state).tabs.map((tab) => tabTitle(tab))).toEqual([
      'Auth',
      'JS Query',
      'SQL',
      'z-orders',
      'customers',
    ]);
  });

  it('normalizes duplicate restored ids without changing canonical Firestore state', () => {
    const first = getFirestoreTab(createInitialTabsState('emu'), 'tab-firestore');
    const restored = tabsRestored({
      activeTabId: first.id,
      interactionHistory: [firestoreEntry(first.id, 'emu', 'orders')],
      interactionHistoryIndex: 0,
      selectedTreeItemId: 'collection:emu:orders',
      tabs: [
        first,
        { ...first, draft: createFirestoreDraft('admin-leagues') },
      ],
    });

    expect(restored.tabs.map((tab) => ({ id: tab.id, title: tabTitle(tab) }))).toEqual([
      { id: 'tab-firestore', title: 'orders' },
      { id: 'tab-firestore-2', title: 'admin-leagues' },
    ]);
  });

  it('tracks non-workspace auth selection independently', () => {
    const state = authUserSelected(initialSelectionState, 'u_ada');

    expect(state).toEqual({
      authUserId: 'u_ada',
    });
  });
});

function queryDraft(
  path: string,
  overrides: Partial<FirestoreQueryDraft> = {},
): FirestoreQueryDraft {
  return {
    ...DEFAULT_FIRESTORE_DRAFT,
    filters: [],
    path,
    ...overrides,
  };
}

function getFirestoreTab(state: TabsState, tabId: string): FirestoreQueryTab {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab || tab.kind !== 'firestore-query') throw new Error(`Missing Firestore tab ${tabId}`);
  return tab;
}

function interactionEntry(
  tab: FirestoreQueryTab,
  selectedTreeItemId: string | null,
): InteractionHistoryEntry {
  return {
    activeTabId: tab.id,
    location: interactionLocationForTab(tab),
    selectedTreeItemId,
  };
}

function firestoreEntry(
  activeTabId: string,
  connectionId: string,
  path: string,
): InteractionHistoryEntry {
  return {
    activeTabId,
    location: {
      kind: 'firestore-query',
      connectionId,
      draft: createFirestoreDraft(path),
    },
    selectedTreeItemId: `collection:${connectionId}:${path}`,
  };
}
