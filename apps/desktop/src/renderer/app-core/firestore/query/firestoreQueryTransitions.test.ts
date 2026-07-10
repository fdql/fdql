import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import type { FirestoreDocumentResult, FirestoreQuery } from '@firebase-desk/repo-contracts';
import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import { describe, expect, it } from 'vitest';
import {
  firestoreQueryDraftMetadata,
  isCurrentFirestoreQueryExecution,
  selectFirestoreLoadedPageCount,
  selectFirestoreResultExecution,
  selectFirestoreResultRows,
  selectFirestoreSelectedDocument,
  selectFirestoreTabResultState,
} from './firestoreQuerySelectors.ts';
import {
  createInitialFirestoreQueryRuntimeState,
  type SubmittedFirestoreQuery,
  type SubmittedFirestoreSubcollectionLoad,
} from './firestoreQueryState.ts';
import {
  firestoreCollectionJobSucceeded,
  firestoreDocumentSelected,
  firestoreLoadMoreFailed,
  firestoreLoadMoreStarted,
  firestoreLoadMoreSucceeded,
  firestorePendingPageReloadCleared,
  firestoreQueryCompletionRecorded,
  firestoreQueryFailed,
  firestoreQueryStarted,
  firestoreQuerySucceeded,
  firestoreRefreshStarted,
  firestoreRefreshSucceeded,
  firestoreResultDocumentDeleted,
  firestoreResultDocumentSaved,
  firestoreResultsMarkedStale,
  firestoreResultsRefreshed,
  firestoreSubcollectionsLoaded,
  firestoreSubcollectionsLoadStarted,
  firestoreTabCleared,
  firestoreTabRuntimeInvalidated,
} from './firestoreQueryTransitions.ts';

describe('firestore query transitions and selectors', () => {
  it('starts a loading execution with epoch and monotonic request id', () => {
    const selected = firestoreDocumentSelected(
      createInitialFirestoreQueryRuntimeState(),
      'tab-1',
      'orders/ord_1',
    );

    const state = firestoreQueryStarted(selected, {
      clearSelection: true,
      draft: queryDraft({ path: 'orders' }),
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });

    expect(state.queryRequests['tab-1']).toMatchObject({
      limit: 25,
      requestId: 1,
      runId: 1,
      token: { epoch: 0, requestId: 1 },
    });
    expect(resultFor(state, 'tab-1').execution).toBe(state.queryRequests['tab-1']);
    expect(selectFirestoreResultExecution(state, tab('tab-1'))?.draft.path).toBe('orders');
    expect(isCurrentFirestoreQueryExecution(state, state.queryRequests['tab-1']!)).toBe(true);
    expect(state.nextRequestId).toBe(2);
    expect(state.selectedDocumentPaths['tab-1']).toBeUndefined();
    expect(resultFor(state, 'tab-1').status).toBe('loading');
  });

  it('stores successful and failed query results', () => {
    const row = document('orders/ord_1');
    const submitted = startQuery();
    const execution = submitted.queryRequests['tab-1']!;
    const succeeded = firestoreQuerySucceeded(
      submitted,
      'tab-1',
      [{ items: [row] }],
      true,
      execution,
    );

    expect(resultFor(succeeded, 'tab-1').pages).toEqual([{ items: [row] }]);
    expect(resultFor(succeeded, 'tab-1').hasMore).toBe(true);
    expect(resultFor(succeeded, 'tab-1').status).toBe('success');

    const failed = firestoreQueryFailed(succeeded, 'tab-1', 'failed', execution);
    expect(resultFor(failed, 'tab-1').errorMessage).toBe('failed');
    expect(resultFor(failed, 'tab-1').status).toBe('error');
  });

  it('loads more pages and captures load-more errors', () => {
    const submitted = firestoreQueryStarted(createInitialFirestoreQueryRuntimeState(), {
      clearSelection: true,
      draft: queryDraft(),
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });
    const execution = submitted.queryRequests['tab-1']!;
    const withResult = firestoreQuerySucceeded(
      submitted,
      'tab-1',
      [{ items: [], nextCursor: { token: 'page-2' } }],
      true,
      execution,
    );
    const started = firestoreLoadMoreStarted(withResult, 'tab-1');
    expect(resultFor(started, 'tab-1').isFetchingMore).toBe(true);

    const loaded = firestoreLoadMoreSucceeded(
      started,
      'tab-1',
      { items: [document('orders/ord_1')] },
      false,
      execution,
    );
    expect(resultFor(loaded, 'tab-1').pages).toHaveLength(2);
    expect(resultFor(loaded, 'tab-1').isFetchingMore).toBe(false);

    const failed = firestoreLoadMoreFailed(started, 'tab-1', 'fetch failed', execution);
    expect(resultFor(failed, 'tab-1').errorMessage).toBe('fetch failed');
    expect(resultFor(failed, 'tab-1').isFetchingMore).toBe(false);
  });

  it('refreshes from page one and tracks loaded page reload count', () => {
    const state = firestoreRefreshStarted(createInitialFirestoreQueryRuntimeState(), {
      draft: queryDraft({ path: 'orders' }),
      limit: 25,
      pagesToReload: 3,
      query: query('orders'),
      tabId: 'tab-1',
    });

    expect(state.pendingPageReloads['tab-1']).toBe(3);

    const execution = state.queryRequests['tab-1']!;
    const refreshed = firestoreRefreshSucceeded(
      state,
      'tab-1',
      [{ items: [] }],
      false,
      execution,
    );
    expect(refreshed.pendingPageReloads['tab-1']).toBeUndefined();
    expect(resultFor(refreshed, 'tab-1').resultsStale).toBe(false);
    expect(resultFor(refreshed, 'tab-1').status).toBe('success');
  });

  it('changes selection, stale state, and tab scoped state', () => {
    const selected = firestoreDocumentSelected(
      loadedQuery().state,
      'tab-1',
      'a/b',
    );
    expect(selected.selectedDocumentPaths['tab-1']).toBe('a/b');

    const stale = firestoreResultsMarkedStale(selected, 'tab-1');
    expect(resultFor(stale, 'tab-1').resultsStale).toBe(true);
    const refreshed = firestoreResultsRefreshed(stale, 'tab-1');
    expect(resultFor(refreshed, 'tab-1').resultsStale).toBe(false);

    const clearedReload = firestorePendingPageReloadCleared(
      { ...stale, pendingPageReloads: { 'tab-1': 2 } },
      'tab-1',
    );
    expect(clearedReload.pendingPageReloads['tab-1']).toBeUndefined();

    const recorded = firestoreQueryCompletionRecorded(stale, 'tab-1:1');
    expect(recorded.recordedQueryCompletions['tab-1:1']).toBe(true);

    const clearedTab = firestoreTabCleared(recorded, 'tab-1');
    expect(clearedTab.selectedDocumentPaths['tab-1']).toBeUndefined();
    expect(clearedTab.recordedQueryCompletions['tab-1:1']).toBeUndefined();
  });

  it('invalidates runtime and advances the tab epoch', () => {
    const { execution, state: loaded } = loadedQuery();

    const invalidated = firestoreTabRuntimeInvalidated(loaded, 'tab-1');

    expect(invalidated.queryRequests['tab-1']).toBeUndefined();
    expect(resultFor(invalidated, 'tab-1')).toMatchObject({
      execution: null,
      pages: [],
      status: 'idle',
    });
    expect(invalidated.tabEpochs['tab-1']).toBe(1);
    expect(isCurrentFirestoreQueryExecution(invalidated, execution)).toBe(false);

    const restarted = firestoreQueryStarted(invalidated, {
      clearSelection: true,
      draft: queryDraft(),
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });
    expect(restarted.queryRequests['tab-1']?.token).toMatchObject({
      epoch: 1,
      requestId: 2,
    });

    const cleared = firestoreTabCleared(restarted, 'tab-1');
    expect(cleared.resultsByTab['tab-1']).toBeUndefined();
    expect(cleared.tabEpochs['tab-1']).toBe(2);
  });

  it('merges subcollections only into the submitted tab execution', () => {
    const firstSubmitted = firestoreQueryStarted(createInitialFirestoreQueryRuntimeState(), {
      clearSelection: true,
      draft: queryDraft(),
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });
    const firstExecution = firstSubmitted.queryRequests['tab-1']!;
    const firstLoaded = firestoreQuerySucceeded(
      firstSubmitted,
      'tab-1',
      [{ items: [document('orders/ord_1'), document('orders/ord_2')] }],
      false,
      firstExecution,
    );
    const secondSubmitted = firestoreQueryStarted(firstLoaded, {
      clearSelection: true,
      draft: queryDraft(),
      limit: 25,
      query: query('orders'),
      tabId: 'tab-2',
    });
    const secondExecution = secondSubmitted.queryRequests['tab-2']!;
    const state = firestoreQuerySucceeded(
      secondSubmitted,
      'tab-2',
      [{ items: [document('orders/ord_1')] }],
      false,
      secondExecution,
    );
    const request = subcollectionRequest(firstExecution, 'orders/ord_1');
    const loading = firestoreSubcollectionsLoadStarted(state, request);

    const merged = firestoreSubcollectionsLoaded(loading, {
      request,
      subcollections: [{ id: 'events', path: 'orders/ord_1/events' }],
    });

    expect(resultFor(merged, 'tab-1').pages[0]?.items[0]?.subcollections).toEqual([{
      id: 'events',
      path: 'orders/ord_1/events',
    }]);
    expect(resultFor(merged, 'tab-1').pages[0]?.items[1]?.subcollections).toBeUndefined();
    expect(resultFor(merged, 'tab-2').pages[0]?.items[0]?.subcollections).toBeUndefined();
  });

  it('ignores subcollections from a superseded run', () => {
    const firstSubmitted = firestoreQueryStarted(createInitialFirestoreQueryRuntimeState(), {
      clearSelection: true,
      draft: queryDraft(),
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });
    const firstExecution = firstSubmitted.queryRequests['tab-1']!;
    const firstLoaded = firestoreQuerySucceeded(
      firstSubmitted,
      'tab-1',
      [{ items: [document('orders/ord_1')] }],
      false,
      firstExecution,
    );
    const request = subcollectionRequest(firstExecution, 'orders/ord_1');
    const loading = firestoreSubcollectionsLoadStarted(firstLoaded, request);
    const superseded = firestoreQueryStarted(loading, {
      clearSelection: true,
      draft: queryDraft({ path: 'customers' }),
      limit: 25,
      query: query('customers'),
      tabId: 'tab-1',
    });

    const staleCompletion = firestoreSubcollectionsLoaded(superseded, {
      request,
      subcollections: [{ id: 'events', path: 'orders/ord_1/events' }],
    });

    expect(staleCompletion).toBe(superseded);
  });

  it('ignores subcollections after the tab connection changes', () => {
    const emulatorSubmitted = firestoreQueryStarted(createInitialFirestoreQueryRuntimeState(), {
      clearSelection: true,
      draft: queryDraft(),
      limit: 25,
      query: query('orders', 'emu'),
      tabId: 'tab-1',
    });
    const emulatorExecution = emulatorSubmitted.queryRequests['tab-1']!;
    const emulatorLoaded = firestoreQuerySucceeded(
      emulatorSubmitted,
      'tab-1',
      [{ items: [document('orders/ord_1')] }],
      false,
      emulatorExecution,
    );
    const request = subcollectionRequest(emulatorExecution, 'orders/ord_1');
    const loading = firestoreSubcollectionsLoadStarted(emulatorLoaded, request);
    const productionSubmitted = firestoreQueryStarted(loading, {
      clearSelection: true,
      draft: queryDraft(),
      limit: 25,
      query: query('orders', 'prod'),
      tabId: 'tab-1',
    });

    const staleCompletion = firestoreSubcollectionsLoaded(productionSubmitted, {
      request,
      subcollections: [{ id: 'events', path: 'orders/ord_1/events' }],
    });

    expect(staleCompletion).toBe(productionSubmitted);
  });

  it('replaces a visible document and preserves loaded subcollection documents', () => {
    const nested = document('orders/ord_1/events/evt_1', { type: 'created' });
    const row = {
      ...document('orders/ord_1', { status: 'draft' }),
      hasSubcollections: true,
      subcollections: [{
        id: 'events',
        path: 'orders/ord_1/events',
        documents: [nested],
      } as CollectionWithDocuments],
      updateTime: '2026-01-01T00:00:00.000Z',
    };
    const submitted = startQuery();
    const execution = submitted.queryRequests['tab-1']!;
    const state = firestoreQuerySucceeded(
      submitted,
      'tab-1',
      [{ items: [row], nextCursor: { token: 'cursor-1' } }],
      true,
      execution,
    );

    const updated = firestoreResultDocumentSaved(state, execution, {
      ...document('orders/ord_1', { status: 'paid' }),
      updateTime: '2026-01-01T00:01:00.000Z',
    });

    const page = resultFor(updated, 'tab-1').pages[0]!;
    expect(page.nextCursor).toEqual({ token: 'cursor-1' });
    expect(resultFor(updated, 'tab-1').hasMore).toBe(true);
    expect(resultFor(updated, 'tab-1').resultsStale).toBe(true);
    expect(page.items[0]).toMatchObject({
      data: { status: 'paid' },
      updateTime: '2026-01-01T00:01:00.000Z',
      subcollections: [{
        documents: [nested],
        path: 'orders/ord_1/events',
      }],
    });
  });

  it('replaces and removes nested loaded subcollection documents', () => {
    const row = {
      ...document('orders/ord_1'),
      hasSubcollections: true,
      subcollections: [{
        id: 'events',
        path: 'orders/ord_1/events',
        documents: [
          document('orders/ord_1/events/evt_1', { type: 'created' }),
          document('orders/ord_1/events/evt_2', { type: 'deleted' }),
        ],
      } as CollectionWithDocuments],
    };
    const submitted = startQuery();
    const execution = submitted.queryRequests['tab-1']!;
    const state = firestoreDocumentSelected(
      firestoreQuerySucceeded(
        submitted,
        'tab-1',
        [{ items: [row] }],
        false,
        execution,
      ),
      'tab-1',
      'orders/ord_1/events/evt_2',
    );

    const replaced = firestoreResultDocumentSaved(
      state,
      execution,
      document('orders/ord_1/events/evt_1', { type: 'updated' }),
    );
    const deleted = firestoreResultDocumentDeleted(
      replaced,
      execution,
      'orders/ord_1/events/evt_2',
    );
    const collection = resultFor(deleted, 'tab-1').pages[0]?.items[0]
      ?.subcollections?.[0] as CollectionWithDocuments | undefined;

    expect(collection?.documents).toEqual([
      document('orders/ord_1/events/evt_1', { type: 'updated' }),
    ]);
    expect(deleted.selectedDocumentPaths['tab-1']).toBeUndefined();
  });

  it('removes a deleted visible document without changing pagination metadata', () => {
    const submitted = startQuery();
    const execution = submitted.queryRequests['tab-1']!;
    const state = firestoreDocumentSelected(
      firestoreQuerySucceeded(
        submitted,
        'tab-1',
        [{
          items: [document('orders/ord_1'), document('orders/ord_2')],
          nextCursor: { token: 'cursor-1' },
        }],
        true,
        execution,
      ),
      'tab-1',
      'orders/ord_1',
    );

    const deleted = firestoreResultDocumentDeleted(state, execution, 'orders/ord_1');

    expect(resultFor(deleted, 'tab-1').pages).toEqual([{
      items: [document('orders/ord_2')],
      nextCursor: { token: 'cursor-1' },
    }]);
    expect(resultFor(deleted, 'tab-1').hasMore).toBe(true);
    expect(resultFor(deleted, 'tab-1').resultsStale).toBe(true);
    expect(deleted.selectedDocumentPaths['tab-1']).toBeUndefined();
  });

  it('marks a newer matching execution stale instead of applying an old write result', () => {
    const firstStarted = startQuery();
    const firstExecution = firstStarted.queryRequests['tab-1']!;
    const firstSucceeded = firestoreQuerySucceeded(
      firstStarted,
      'tab-1',
      [{ items: [document('orders/ord_1', { status: 'draft' })] }],
      false,
      firstExecution,
    );
    const secondStarted = firestoreQueryStarted(firstSucceeded, {
      clearSelection: true,
      draft: queryDraft({ path: 'orders' }),
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });

    const afterSave = firestoreResultDocumentSaved(
      secondStarted,
      firstExecution,
      document('orders/ord_1', { status: 'paid' }),
    );
    const afterDelete = firestoreResultDocumentDeleted(
      secondStarted,
      firstExecution,
      'orders/ord_1',
    );

    expect(resultFor(afterSave, 'tab-1').resultsStale).toBe(true);
    expect(resultFor(afterDelete, 'tab-1').resultsStale).toBe(true);
    const secondExecution = secondStarted.queryRequests['tab-1']!;
    const completed = firestoreQuerySucceeded(
      afterSave,
      'tab-1',
      [{ items: [document('orders/ord_1', { status: 'server' })] }],
      false,
      secondExecution,
    );
    expect(resultFor(completed, 'tab-1')).toMatchObject({
      pages: [{ items: [{ data: { status: 'server' } }] }],
      resultsStale: true,
    });
  });

  it('ignores write result mutations after the target changes', () => {
    const ordersStarted = startQuery();
    const ordersExecution = ordersStarted.queryRequests['tab-1']!;
    const auditStarted = firestoreQueryStarted(
      firestoreTabRuntimeInvalidated(ordersStarted, 'tab-1'),
      {
        clearSelection: true,
        draft: queryDraft({ path: 'auditLogs' }),
        limit: 25,
        query: query('auditLogs'),
        tabId: 'tab-1',
      },
    );

    expect(firestoreResultDocumentSaved(
      auditStarted,
      ordersExecution,
      document('orders/ord_1', { status: 'paid' }),
    )).toBe(auditStarted);
    expect(firestoreResultDocumentDeleted(
      auditStarted,
      ordersExecution,
      'orders/ord_1',
    )).toBe(auditStarted);
  });

  it('marks only overlapping successful collection job targets stale', () => {
    const started = startQuery();
    const execution = started.queryRequests['tab-1']!;
    const state = firestoreQuerySucceeded(
      started,
      'tab-1',
      [{ items: [document('orders/ord_1')] }],
      false,
      execution,
    );
    const otherConnection = collectionJob('prod', 'orders', 'firestore.deleteCollection');
    const exported = collectionJob('emu', 'orders', 'firestore.exportCollection');

    expect(firestoreCollectionJobSucceeded(state, otherConnection)).toBe(state);
    expect(firestoreCollectionJobSucceeded(state, exported)).toBe(state);
    expect(
      resultFor(
        firestoreCollectionJobSucceeded(
          state,
          collectionJob('emu', 'orders/ord_1/events', 'firestore.deleteCollection'),
        ),
        'tab-1',
      ).resultsStale,
    ).toBe(true);
  });

  it('selects rows, selected documents, page count, and query metadata', () => {
    const row = document('orders/ord_1');
    expect(selectFirestoreResultRows([{ items: [row] }])).toEqual([row]);
    expect(selectFirestoreSelectedDocument([row], 'orders/ord_1')).toBe(row);
    expect(selectFirestoreLoadedPageCount([{}], false, false)).toBe(1);
    expect(selectFirestoreLoadedPageCount([], true, true)).toBe(1);
    expect(firestoreQueryDraftMetadata(queryDraft({ path: 'orders', limit: 5 }))).toMatchObject({
      limit: 5,
      path: 'orders',
    });
  });
});

function resultFor(
  state: ReturnType<typeof createInitialFirestoreQueryRuntimeState>,
  tabId: string,
) {
  return selectFirestoreTabResultState(state, { id: tabId, kind: 'firestore-query' });
}

function collectionJob(
  connectionId: string,
  collectionPath: string,
  type: 'firestore.deleteCollection' | 'firestore.exportCollection',
): BackgroundJob {
  return {
    createdAt: '2026-04-29T00:00:00.000Z',
    id: `job:${type}`,
    progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
    request: type === 'firestore.deleteCollection'
      ? { collectionPath, connectionId, includeSubcollections: true, type }
      : {
        collectionPath,
        connectionId,
        encoding: 'encoded',
        filePath: '/tmp/export.jsonl',
        format: 'jsonl',
        includeSubcollections: true,
        type,
      },
    status: 'succeeded',
    title: 'Collection job',
    type,
    updatedAt: '2026-04-29T00:01:00.000Z',
  };
}

function startQuery() {
  return firestoreQueryStarted(createInitialFirestoreQueryRuntimeState(), {
    clearSelection: true,
    draft: queryDraft(),
    limit: 25,
    query: query('orders'),
    tabId: 'tab-1',
  });
}

function loadedQuery(): {
  readonly execution: SubmittedFirestoreQuery;
  readonly state: ReturnType<typeof createInitialFirestoreQueryRuntimeState>;
} {
  const submitted = startQuery();
  const execution = submitted.queryRequests['tab-1']!;
  return {
    execution,
    state: firestoreQuerySucceeded(
      submitted,
      'tab-1',
      [{ items: [document('orders/ord_1')] }],
      false,
      execution,
    ),
  };
}

function subcollectionRequest(
  execution: SubmittedFirestoreQuery,
  documentPath: string,
): SubmittedFirestoreSubcollectionLoad {
  const token = Object.freeze({ documentPath, queryToken: execution.token });
  return Object.freeze({ documentPath, execution, token });
}

function tab(id: string) {
  return { id, kind: 'firestore-query' } as const;
}

function query(path: string, connectionId = 'emu'): FirestoreQuery {
  return { connectionId, filters: [], path };
}

function queryDraft(
  overrides: Partial<FirestoreQueryDraft> = {},
): FirestoreQueryDraft {
  return {
    filterField: '',
    filterOp: '==',
    filterValue: '',
    filters: [],
    limit: 25,
    path: 'orders',
    sortDirection: 'asc',
    sortField: '',
    ...overrides,
  };
}

function document(path: string, data: Record<string, unknown> = {}): FirestoreDocumentResult {
  return { data, hasSubcollections: false, id: path.split('/').at(-1) ?? path, path };
}

type CollectionWithDocuments = NonNullable<FirestoreDocumentResult['subcollections']>[number] & {
  readonly documents: ReadonlyArray<FirestoreDocumentResult>;
};
