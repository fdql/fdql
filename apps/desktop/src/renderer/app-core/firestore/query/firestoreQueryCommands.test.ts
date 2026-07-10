import type {
  FirestoreDocumentResult,
  FirestoreQuery,
  FirestoreQueryDraft,
} from '@firebase-desk/repo-contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAppCoreStore } from '../../shared/store.ts';
import {
  completeFirestoreQueryCommand,
  completeFirestoreSubcollectionsLoadCommand,
  continueFirestorePageReloadCommand,
  executeFirestoreLoadMoreCommand,
  executeFirestoreQueryCommand,
  failFirestoreSubcollectionsLoadCommand,
  firestoreQueryCompletionActivity,
  loadMoreFirestoreQueryCommand,
  openFirestoreDocumentInNewTabCommand,
  refreshFirestoreQueryCommand,
  runFirestoreQueryCommand,
  startFirestoreSubcollectionsLoadCommand,
} from './firestoreQueryCommands.ts';
import { selectFirestoreTabResultState } from './firestoreQuerySelectors.ts';
import { createInitialFirestoreQueryRuntimeState } from './firestoreQueryState.ts';
import { firestoreQuerySucceeded } from './firestoreQueryTransitions.ts';

describe('firestore query commands', () => {
  it('submits a query and returns a tab interaction intent', () => {
    const activeDraft = draft('orders');
    const filterValue = { statuses: ['paid'] };
    const submittedQuery: FirestoreQuery = {
      ...query('orders'),
      filters: [{ field: 'status', op: 'in', value: filterValue }],
    };
    const result = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft,
      clearSelection: true,
      query: submittedQuery,
      selectedTreeItemId: 'collection:emu:orders',
      tab,
    });

    expect(result.path).toBe('orders');
    expect(result.interaction).toEqual({
      activeTabId: tab.id,
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
    const execution = result.state.queryRequests[tab.id]!;
    filterValue.statuses.push('refunded');
    expect(execution).toMatchObject({ runId: 1 });
    expect(execution.draft).not.toBe(activeDraft);
    expect(execution.query).not.toBe(submittedQuery);
    expect(Object.isFrozen(execution)).toBe(true);
    expect(Object.isFrozen(execution.token)).toBe(true);
    expect(execution.query.filters?.[0]?.value).toEqual({ statuses: ['paid'] });
    expect(Object.isFrozen(execution.query.filters?.[0]?.value)).toBe(true);
  });

  it('returns no-op results when no Firestore query tab is active', () => {
    const state = createInitialFirestoreQueryRuntimeState();
    const result = runFirestoreQueryCommand(state, {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab: undefined,
    });

    expect(result).toEqual({ interaction: null, path: null, state });
  });

  it('ignores invisible scheduler queries until a background runner exists', () => {
    const state = createInitialFirestoreQueryRuntimeState();
    const result = runFirestoreQueryCommand(state, {
      activeDraft: draft('orders'),
      clearSelection: false,
      commandOptions: {
        serializationKey: 'nightly-orders',
        source: 'scheduler',
        visible: false,
      },
      query: query('orders'),
      selectedTreeItemId: null,
      tab: undefined,
    });

    expect(result.interaction).toBeNull();
    expect(result.path).toBeNull();
    expect(result.state).toEqual(state);

    const activeTabResult = runFirestoreQueryCommand(state, {
      activeDraft: draft('orders'),
      clearSelection: false,
      commandOptions: { source: 'scheduler', visible: false },
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    });
    expect(activeTabResult).toEqual({ interaction: null, path: null, state });
  });

  it('submits refreshes without clearing selection and stores pages to reload', () => {
    const result = refreshFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: false,
      pagesToReload: 2,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    });

    expect(result.path).toBe('orders');
    expect(result.state.pendingPageReloads[tab.id]).toBe(2);
  });

  it('returns a load more intent only for collection queries', () => {
    const submitted = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const execution = submitted.queryRequests[tab.id]!;
    const loaded = firestoreQuerySucceeded(
      submitted,
      tab.id,
      [{ items: [row('ord_1')], nextCursor: { token: 'page-2' } }],
      true,
      execution,
    );
    const collectionResult = loadMoreFirestoreQueryCommand(
      loaded,
      {
        isDocumentQuery: false,
        tabId: tab.id,
      },
    );
    expect(collectionResult.shouldFetchNextPage).toBe(true);
    expect(resultFor(collectionResult.state, tab.id).isFetchingMore).toBe(true);
    expect(loadMoreFirestoreQueryCommand(collectionResult.state, {
      isDocumentQuery: false,
      tabId: tab.id,
    })).toEqual({ shouldFetchNextPage: false, state: collectionResult.state });

    const documentState = createInitialFirestoreQueryRuntimeState();
    expect(loadMoreFirestoreQueryCommand(documentState, {
      isDocumentQuery: true,
      tabId: tab.id,
    })).toEqual({
      shouldFetchNextPage: false,
      state: documentState,
    });
  });

  it('continues partial refreshes from app-core state', () => {
    const state = refreshFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: false,
      pagesToReload: 3,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;

    expect(continueFirestorePageReloadCommand(state, {
      hasNextPage: true,
      isDocumentQuery: false,
      isFetchingNextPage: false,
      loadedPageCount: 1,
      pendingPageReloadCount: 3,
      tabId: tab.id,
    })).toEqual({ shouldFetchNextPage: true, state });

    const completed = continueFirestorePageReloadCommand(state, {
      hasNextPage: true,
      isDocumentQuery: false,
      isFetchingNextPage: false,
      loadedPageCount: 3,
      pendingPageReloadCount: 3,
      tabId: tab.id,
    });

    expect(completed.shouldFetchNextPage).toBe(false);
    expect(completed.state.pendingPageReloads[tab.id]).toBeUndefined();
  });

  it('records query completion once and waits for refresh reloads', () => {
    const state = refreshFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: false,
      pagesToReload: 2,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;

    expect(completeFirestoreQueryCommand(state, {
      connectionId: 'emu',
      draft: draft('orders'),
      errorMessage: null,
      isDocumentQuery: false,
      isLoading: false,
      loadedPages: 1,
      pendingPageReloadCount: 2,
      resultCount: 1,
      runId: 1,
      tabId: tab.id,
    })).toEqual({ activity: null, state });

    const readyState = { ...state, pendingPageReloads: {} };
    const recorded = completeFirestoreQueryCommand(readyState, {
      connectionId: 'emu',
      draft: draft('orders'),
      errorMessage: null,
      isDocumentQuery: false,
      isLoading: false,
      loadedPages: 2,
      pendingPageReloadCount: 0,
      resultCount: 2,
      runId: 1,
      tabId: tab.id,
    });

    expect(recorded.activity).toMatchObject({
      action: 'Run query',
      metadata: { loadedPages: 2, resultCount: 2 },
    });
    expect(recorded.state.recordedQueryCompletions[`${tab.id}:1`]).toBe(true);
    expect(
      completeFirestoreQueryCommand(recorded.state, {
        connectionId: 'emu',
        draft: draft('orders'),
        errorMessage: null,
        isDocumentQuery: false,
        isLoading: false,
        loadedPages: 2,
        pendingPageReloadCount: 0,
        resultCount: 2,
        runId: 1,
        tabId: tab.id,
      }).activity,
    ).toBeNull();
  });

  it('executes collection queries from app-core and records one completion', async () => {
    const submitted = refreshFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: false,
      pagesToReload: 2,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const store = createAppCoreStore(submitted);
    const recordActivity = vi.fn();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145);
    const runQuery = vi.fn()
      .mockResolvedValueOnce({ items: [row('ord_1')], nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: [row('ord_2')], nextCursor: null });

    await executeFirestoreQueryCommand(store, {
      getDocument: vi.fn(),
      now,
      recordActivity,
      runQuery,
    }, {
      draft: draft('orders'),
      isRefresh: true,
      pagesToLoad: 2,
      request: submitted.queryRequests[tab.id]!,
      tab,
    });

    expect(runQuery).toHaveBeenNthCalledWith(1, query('orders'), { limit: 25 });
    expect(runQuery).toHaveBeenNthCalledWith(2, query('orders'), {
      cursor: { token: 'page-2' },
      limit: 25,
    });
    expect(store.get().resultsByTab[tab.id]?.pages).toHaveLength(2);
    expect(store.get().resultsByTab[tab.id]?.execution).toBe(submitted.queryRequests[tab.id]);
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      durationMs: 45,
      metadata: expect.objectContaining({ loadedPages: 2, resultCount: 2 }),
      status: 'success',
    }));
  });

  it('ignores stale query execution results', async () => {
    const first = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const second = runFirestoreQueryCommand(first, {
      activeDraft: draft('customers'),
      clearSelection: true,
      query: query('customers'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const store = createAppCoreStore(second);
    const recordActivity = vi.fn();

    await executeFirestoreQueryCommand(store, {
      getDocument: vi.fn(),
      now: vi.fn(() => 0),
      recordActivity,
      runQuery: vi.fn(async () => ({ items: [row('ord_1')], nextCursor: null })),
    }, {
      draft: draft('orders'),
      isRefresh: false,
      pagesToLoad: 1,
      request: first.queryRequests[tab.id]!,
      tab,
    });

    expect(store.get().resultsByTab[tab.id]?.pages).toEqual([]);
    expect(store.get().queryRequests[tab.id]?.query.path).toBe('customers');
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it('ignores an execution whose scalar token was reused after runtime reset', async () => {
    const first = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const replacement = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const firstExecution = first.queryRequests[tab.id]!;
    const replacementExecution = replacement.queryRequests[tab.id]!;
    const store = createAppCoreStore(replacement);
    const recordActivity = vi.fn();

    await executeFirestoreQueryCommand(store, {
      getDocument: vi.fn(),
      now: vi.fn(() => 0),
      recordActivity,
      runQuery: vi.fn(async () => ({ items: [row('ord_1')], nextCursor: null })),
    }, {
      draft: draft('orders'),
      isRefresh: false,
      pagesToLoad: 1,
      request: firstExecution,
      tab,
    });

    expect(firstExecution.token).toMatchObject(replacementExecution.token);
    expect(firstExecution.token).not.toBe(replacementExecution.token);
    expect(store.get()).toBe(replacement);
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it('executes load more from app-core using the stored cursor', async () => {
    const submitted = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const store = createAppCoreStore(submitted);
    const recordActivity = vi.fn();
    const now = vi.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(15)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(54);
    const runQuery = vi.fn()
      .mockResolvedValueOnce({ items: [row('ord_1')], nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: [row('ord_2')], nextCursor: null });

    await executeFirestoreQueryCommand(store, {
      getDocument: vi.fn(),
      now,
      runQuery,
    }, {
      draft: draft('orders'),
      isRefresh: false,
      pagesToLoad: 1,
      request: submitted.queryRequests[tab.id]!,
      tab,
    });
    const loadMore = loadMoreFirestoreQueryCommand(store.get(), {
      isDocumentQuery: false,
      tabId: tab.id,
    });
    store.set(loadMore.state);

    await executeFirestoreLoadMoreCommand(store, {
      getDocument: vi.fn(),
      now,
      recordActivity,
      runQuery,
    }, {
      request: store.get().queryRequests[tab.id]!,
      tab,
    });

    expect(runQuery).toHaveBeenLastCalledWith(query('orders'), {
      cursor: { token: 'page-2' },
      limit: 25,
    });
    expect(
      store.get().resultsByTab[tab.id]?.pages.flatMap((page) => page.items.map((item) => item.id)),
    ).toEqual([
      'ord_1',
      'ord_2',
    ]);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Load more results',
      durationMs: 24,
      metadata: expect.objectContaining({ resultCount: 1 }),
      status: 'success',
    }));
  });

  it('merges loaded subcollections and returns document open intents', () => {
    const submitted = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const execution = submitted.queryRequests[tab.id]!;
    const loaded = firestoreQuerySucceeded(
      submitted,
      tab.id,
      [{
        items: [{ data: {}, hasSubcollections: true, id: 'ord_1', path: 'orders/ord_1' }],
      }],
      false,
      execution,
    );
    const started = startFirestoreSubcollectionsLoadCommand(loaded, {
      documentPath: 'orders/ord_1',
      execution,
    });
    expect(started.request).not.toBeNull();
    expect(Object.values(started.state.subcollectionRequests)).toEqual([started.request]);
    const withPage = completeFirestoreSubcollectionsLoadCommand(started.state, {
      request: started.request!,
      subcollections: [{ id: 'events', path: 'orders/ord_1/events' }],
    });
    expect(resultFor(withPage, tab.id).pages[0]?.items[0]?.subcollections).toEqual([{
      id: 'events',
      path: 'orders/ord_1/events',
    }]);
    expect(openFirestoreDocumentInNewTabCommand('emu', 'orders/ord_1')).toEqual({
      connectionId: 'emu',
      path: 'orders/ord_1',
    });
  });

  it('clears only the exact failed subcollection request so it can retry', () => {
    const submitted = runFirestoreQueryCommand(createInitialFirestoreQueryRuntimeState(), {
      activeDraft: draft('orders'),
      clearSelection: true,
      query: query('orders'),
      selectedTreeItemId: null,
      tab,
    }).state;
    const execution = submitted.queryRequests[tab.id]!;
    const loaded = firestoreQuerySucceeded(
      submitted,
      tab.id,
      [{ items: [row('ord_1')] }],
      false,
      execution,
    );
    const first = startFirestoreSubcollectionsLoadCommand(loaded, {
      documentPath: 'orders/ord_1',
      execution,
    });

    const failed = failFirestoreSubcollectionsLoadCommand(first.state, first.request!);
    const retry = startFirestoreSubcollectionsLoadCommand(failed, {
      documentPath: 'orders/ord_1',
      execution,
    });
    const staleFailure = failFirestoreSubcollectionsLoadCommand(retry.state, first.request!);

    expect(Object.values(failed.subcollectionRequests)).toEqual([]);
    expect(retry.request?.token).not.toBe(first.request?.token);
    expect(staleFailure).toBe(retry.state);
  });

  it('builds query completion activity for collection and document reads', () => {
    expect(firestoreQueryCompletionActivity({
      commandOptions: { source: 'scheduler', visible: false },
      connectionId: 'emu',
      draft: draft('orders'),
      durationMs: 12,
      errorMessage: null,
      loadedPages: 2,
      resultCount: 5,
    })).toMatchObject({
      action: 'Run query',
      durationMs: 12,
      metadata: {
        command: expect.objectContaining({ source: 'scheduler', visible: false }),
        isDocument: false,
        loadedPages: 2,
        resultCount: 5,
      },
      status: 'success',
      target: { path: 'orders', type: 'firestore-query' },
    });

    expect(firestoreQueryCompletionActivity({
      connectionId: 'emu',
      draft: draft('orders/ord_1'),
      errorMessage: 'missing',
      loadedPages: 0,
      resultCount: 0,
    })).toMatchObject({
      action: 'Read document',
      error: { message: 'missing' },
      metadata: { isDocument: true },
      status: 'failure',
      target: { path: 'orders/ord_1', type: 'firestore-document' },
    });

    expect(firestoreQueryCompletionActivity({
      connectionId: 'emu',
      draft: draft(''),
      errorMessage: 'Path is required.',
      loadedPages: 0,
      resultCount: 0,
    })).toMatchObject({
      action: 'Run query',
      metadata: { isDocument: false },
      status: 'failure',
      target: { path: '', type: 'firestore-query' },
    });
  });
});

function resultFor(
  state: ReturnType<typeof createInitialFirestoreQueryRuntimeState>,
  tabId: string,
) {
  return selectFirestoreTabResultState(state, { id: tabId, kind: 'firestore-query' });
}

const tab = {
  connectionId: 'emu',
  history: ['orders'],
  historyIndex: 0,
  id: 'tab-1',
  inspectorWidth: 360,
  kind: 'firestore-query',
  title: 'orders',
};

function query(path: string): FirestoreQuery {
  return { connectionId: 'emu', filters: [], path };
}

function draft(path: string): FirestoreQueryDraft {
  return {
    filterField: '',
    filterOp: '==',
    filterValue: '',
    filters: [],
    limit: 25,
    path,
    sortDirection: 'asc',
    sortField: '',
  };
}

function row(id: string): FirestoreDocumentResult {
  return {
    data: { status: 'paid' },
    hasSubcollections: false,
    id,
    path: `orders/${id}`,
  };
}
