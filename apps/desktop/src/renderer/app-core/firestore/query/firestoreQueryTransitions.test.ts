import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import type { FirestoreDocumentResult, FirestoreQuery } from '@firebase-desk/repo-contracts';
import { describe, expect, it } from 'vitest';
import {
  firestoreQueryDraftMetadata,
  selectFirestoreLoadedPageCount,
  selectFirestoreResultRows,
  selectFirestoreSelectedDocument,
  selectFirestoreTabResultState,
} from './firestoreQuerySelectors.ts';
import { createInitialFirestoreQueryRuntimeState } from './firestoreQueryState.ts';
import {
  firestoreDocumentSelected,
  firestoreDraftChanged,
  firestoreInspectorOverviewCollapsedChanged,
  firestoreInspectorSectionChanged,
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
  firestoreResultTreeExpandedIdsChanged,
  firestoreResultViewChanged,
  firestoreSelectionPreviewExpandedPathsChanged,
  firestoreSubcollectionsLoaded,
  firestoreTabCleared,
} from './firestoreQueryTransitions.ts';

describe('firestore query transitions and selectors', () => {
  it('updates drafts by tab', () => {
    const draft = queryDraft({ path: 'orders' });
    const state = firestoreDraftChanged(createInitialFirestoreQueryRuntimeState(), 'tab-1', draft);

    expect(state.drafts['tab-1']).toBe(draft);
  });

  it('starts queries, increments run ids, and clears selection when requested', () => {
    const selected = firestoreDocumentSelected(
      createInitialFirestoreQueryRuntimeState(),
      'tab-1',
      'orders/ord_1',
    );

    const state = firestoreQueryStarted(selected, {
      clearSelection: true,
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });

    expect(state.queryRequests['tab-1']).toMatchObject({ limit: 25, runId: 1 });
    expect(state.nextRunId).toBe(2);
    expect(state.selectedDocumentPaths['tab-1']).toBeUndefined();
    expect(resultFor(state, 'tab-1').isLoading).toBe(true);
  });

  it('stores successful and failed query results', () => {
    const row = document('orders/ord_1');
    const succeeded = firestoreQuerySucceeded(
      createInitialFirestoreQueryRuntimeState(),
      'tab-1',
      [{ items: [row] }],
      true,
    );

    expect(resultFor(succeeded, 'tab-1').pages).toEqual([{ items: [row] }]);
    expect(resultFor(succeeded, 'tab-1').hasMore).toBe(true);
    expect(resultFor(succeeded, 'tab-1').isLoading).toBe(false);

    const failed = firestoreQueryFailed(succeeded, 'tab-1', 'failed');
    expect(resultFor(failed, 'tab-1').errorMessage).toBe('failed');
    expect(resultFor(failed, 'tab-1').isLoading).toBe(false);
  });

  it('loads more pages and captures load-more errors', () => {
    const started = firestoreLoadMoreStarted(createInitialFirestoreQueryRuntimeState(), 'tab-1');
    expect(resultFor(started, 'tab-1').isFetchingMore).toBe(true);

    const loaded = firestoreLoadMoreSucceeded(
      started,
      'tab-1',
      { items: [document('orders/ord_1')] },
      false,
    );
    expect(resultFor(loaded, 'tab-1').pages).toHaveLength(1);
    expect(resultFor(loaded, 'tab-1').isFetchingMore).toBe(false);

    const failed = firestoreLoadMoreFailed(started, 'tab-1', 'fetch failed');
    expect(resultFor(failed, 'tab-1').errorMessage).toBe('fetch failed');
    expect(resultFor(failed, 'tab-1').isFetchingMore).toBe(false);
  });

  it('refreshes from page one and tracks loaded page reload count', () => {
    const state = firestoreRefreshStarted(createInitialFirestoreQueryRuntimeState(), {
      limit: 25,
      pagesToReload: 3,
      query: query('orders'),
      tabId: 'tab-1',
    });

    expect(state.pendingPageReloads['tab-1']).toBe(3);

    const refreshed = firestoreRefreshSucceeded(state, 'tab-1', [{ items: [] }]);
    expect(refreshed.pendingPageReloads['tab-1']).toBeUndefined();
    expect(resultFor(refreshed, 'tab-1').resultsStale).toBe(false);
  });

  it('changes result view, selection, stale state, and tab scoped state', () => {
    const selected = firestoreDocumentSelected(
      createInitialFirestoreQueryRuntimeState(),
      'tab-1',
      'a/b',
    );
    expect(selected.selectedDocumentPaths['tab-1']).toBe('a/b');

    const viewChanged = firestoreResultViewChanged(selected, 'tab-1', 'json');
    expect(resultFor(viewChanged, 'tab-1').resultView).toBe('json');

    const otherTabChanged = firestoreResultViewChanged(viewChanged, 'tab-2', 'tree');
    expect(resultFor(otherTabChanged, 'tab-1').resultView).toBe('json');
    expect(resultFor(otherTabChanged, 'tab-2').resultView).toBe('tree');

    const rerun = firestoreQueryStarted(viewChanged, {
      clearSelection: true,
      limit: 25,
      query: query('orders'),
      tabId: 'tab-1',
    });
    expect(resultFor(rerun, 'tab-1').resultView).toBe('json');

    const stale = firestoreResultsMarkedStale(viewChanged, 'tab-1');
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

  it('keeps inspector UI state scoped by tab', () => {
    const state = createInitialFirestoreQueryRuntimeState();

    const collapsed = firestoreInspectorOverviewCollapsedChanged(state, 'tab-1', true);
    const sectionChanged = firestoreInspectorSectionChanged(
      collapsed,
      'tab-1',
      'fieldsInResults',
      true,
    );
    const previewChanged = firestoreSelectionPreviewExpandedPathsChanged(
      sectionChanged,
      'tab-1',
      'orders/ord_1',
      ['["customer"]'],
    );
    const treeChanged = firestoreResultTreeExpandedIdsChanged(
      previewChanged,
      'tab-1',
      ['root:orders'],
    );

    expect(treeChanged.inspectorUiByTab['tab-1']).toMatchObject({
      overviewCollapsed: true,
      resultTreeExpandedIds: ['root:orders'],
      sections: {
        fieldsInResults: true,
        selectionPreview: true,
      },
      selectionPreviewExpandedPathsByDocumentPath: {
        'orders/ord_1': ['["customer"]'],
      },
    });
    expect(treeChanged.inspectorUiByTab['tab-2']).toBeUndefined();
  });

  it('merges loaded subcollections into matching result rows', () => {
    const state = firestoreQuerySucceeded(
      createInitialFirestoreQueryRuntimeState(),
      'tab-1',
      [{ items: [document('orders/ord_1'), document('orders/ord_2')] }],
    );

    const merged = firestoreSubcollectionsLoaded(state, 'orders/ord_1', [{
      id: 'events',
      path: 'orders/ord_1/events',
    }]);

    expect(resultFor(merged, 'tab-1').pages[0]?.items[0]?.subcollections).toEqual([{
      id: 'events',
      path: 'orders/ord_1/events',
    }]);
    expect(resultFor(merged, 'tab-1').pages[0]?.items[1]?.subcollections).toBeUndefined();
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
    const state = firestoreQuerySucceeded(
      createInitialFirestoreQueryRuntimeState(),
      'tab-1',
      [{ items: [row], nextCursor: { token: 'cursor-1' } }],
      true,
    );

    const updated = firestoreResultDocumentSaved(state, 'tab-1', {
      ...document('orders/ord_1', { status: 'paid' }),
      updateTime: '2026-01-01T00:01:00.000Z',
    });

    const page = resultFor(updated, 'tab-1').pages[0]!;
    expect(page.nextCursor).toEqual({ token: 'cursor-1' });
    expect(resultFor(updated, 'tab-1').hasMore).toBe(true);
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
    const state = firestoreDocumentSelected(
      firestoreQuerySucceeded(
        createInitialFirestoreQueryRuntimeState(),
        'tab-1',
        [{ items: [row] }],
      ),
      'tab-1',
      'orders/ord_1/events/evt_2',
    );

    const replaced = firestoreResultDocumentSaved(
      state,
      'tab-1',
      document('orders/ord_1/events/evt_1', { type: 'updated' }),
    );
    const deleted = firestoreResultDocumentDeleted(
      replaced,
      'tab-1',
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
    const state = firestoreDocumentSelected(
      firestoreQuerySucceeded(
        createInitialFirestoreQueryRuntimeState(),
        'tab-1',
        [{
          items: [document('orders/ord_1'), document('orders/ord_2')],
          nextCursor: { token: 'cursor-1' },
        }],
        true,
      ),
      'tab-1',
      'orders/ord_1',
    );

    const deleted = firestoreResultDocumentDeleted(state, 'tab-1', 'orders/ord_1');

    expect(resultFor(deleted, 'tab-1').pages).toEqual([{
      items: [document('orders/ord_2')],
      nextCursor: { token: 'cursor-1' },
    }]);
    expect(resultFor(deleted, 'tab-1').hasMore).toBe(true);
    expect(deleted.selectedDocumentPaths['tab-1']).toBeUndefined();
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

function query(path: string): FirestoreQuery {
  return { connectionId: 'emu', filters: [], path };
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
