// @vitest-environment jsdom

import type {
  ActivityLogAppendInput,
  FirestoreDocumentResult,
  FirestoreQuery,
  ProjectSummary,
} from '@firebase-desk/repo-contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreDraft } from '../../app-core/firestore/query/firestoreQueryDraft.ts';
import { defaultFirestoreInspectorUiState } from '../../app-core/firestore/query/firestoreQueryState.ts';
import { useRepositories } from '../RepositoryProvider.tsx';
import { selectionActions } from '../stores/selectionStore.ts';
import { tabActions, tabsStore, type WorkspaceTab } from '../stores/tabsStore.ts';
import { useFirestoreTabState } from './useFirestoreTabState.ts';

vi.mock('../RepositoryProvider.tsx', () => ({
  useRepositories: vi.fn(),
}));

const project: ProjectSummary = {
  id: 'emu',
  name: 'Local Emulator',
  projectId: 'demo-local',
  target: 'emulator',
  emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
  hasCredential: false,
  credentialEncrypted: null,
  createdAt: '2026-04-27T00:00:00.000Z',
};

const tab = firestoreTab('tab-firestore-query-1', 'orders');

const rows: ReadonlyArray<FirestoreDocumentResult> = [
  { id: 'ord_1024', path: 'orders/ord_1024', data: { status: 'paid' }, hasSubcollections: false },
];

const openRows: ReadonlyArray<FirestoreDocumentResult> = [
  { id: 'ord_1025', path: 'orders/ord_1025', data: { status: 'open' }, hasSubcollections: false },
];

describe('useFirestoreTabState', () => {
  let firestore: {
    getDocument: ReturnType<typeof vi.fn>;
    listSubcollections: ReturnType<typeof vi.fn>;
    runQuery: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    selectionActions.reset();
    tabActions.restore(tabsState([tab], tab.id));
    firestore = {
      getDocument: vi.fn(async () => null),
      listSubcollections: vi.fn(async () => []),
      runQuery: vi.fn(async () => ({ items: rows, nextCursor: null })),
    };
    vi.mocked(useRepositories).mockReturnValue({ firestore } as never);
  });

  it('merges granular draft edits into the tab-owned draft', () => {
    const { result, rerender } = renderFirestoreHook(tab.id);

    act(() => result.current.editDraft({ type: 'path-set', path: 'customers' }));
    act(() => result.current.editDraft({ type: 'limit-set', limit: 7 }));
    rerender();

    expect(result.current.activeDraft).toMatchObject({ path: 'customers', limit: 7 });
    expect(currentFirestoreTab(tab.id).draft).toMatchObject({ path: 'customers', limit: 7 });
  });

  it('does not let a delayed filter patch overwrite newer path and sort edits', () => {
    const { result, rerender } = renderFirestoreHook(tab.id);

    act(() =>
      result.current.editDraft({
        type: 'filter-add',
        filter: { id: 'status', field: 'status', op: '==', value: '"paid"' },
      })
    );
    act(() => result.current.editDraft({ type: 'path-set', path: 'auditLogs' }));
    act(() => result.current.editDraft({ type: 'sort-direction-set', sortDirection: 'asc' }));
    act(() =>
      result.current.editDraft({
        type: 'filter-patch',
        filterId: 'status',
        patch: { field: 'state' },
      })
    );
    rerender();

    expect(result.current.activeDraft).toMatchObject({
      path: 'auditLogs',
      sortDirection: 'asc',
      filters: [expect.objectContaining({ id: 'status', field: 'state', value: '"paid"' })],
    });
  });

  it('submits an immutable query and records a tagged interaction snapshot', async () => {
    const { result } = renderFirestoreHook(tab.id);

    act(() => {
      expect(result.current.runQuery()).toBe('orders');
    });

    await waitFor(() =>
      expect(firestore.runQuery).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'emu', path: 'orders' }),
        expect.objectContaining({ limit: 25 }),
      )
    );
    expect(tabsStore.state.interactionHistory.at(-1)).toEqual({
      activeTabId: tab.id,
      location: {
        kind: 'firestore-query',
        connectionId: 'emu',
        draft: createFirestoreDraft('orders'),
      },
      selectedTreeItemId: 'collection:emu:orders',
    });
  });

  it('increments query run IDs for repeated submissions', () => {
    const { result } = renderFirestoreHook(tab.id);

    act(() => {
      result.current.runQuery();
      result.current.runQuery();
    });

    expect(result.current.activeQueryRunId).toBe(2);
  });

  it('loads document path queries through the repository', async () => {
    firestore.getDocument.mockResolvedValue(rows[0]);
    const { result, rerender } = renderFirestoreHook(tab.id);

    act(() => result.current.editDraft({ type: 'path-set', path: 'orders/ord_1024' }));
    rerender();
    act(() => {
      result.current.runQuery();
    });

    await waitFor(() =>
      expect(firestore.getDocument).toHaveBeenCalledWith('emu', 'orders/ord_1024')
    );
  });

  it('clears results before applying every effective query edit', async () => {
    const { result, rerender } = renderFirestoreHook(tab.id);
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toEqual(rows));

    act(() => result.current.editDraft({ type: 'limit-set', limit: 1 }));
    rerender();

    expect(result.current.activeDraft.limit).toBe(1);
    expect(result.current.queryRows).toEqual([]);
    expect(result.current.activeQueryPath).toBeNull();
    expect(firestore.runQuery).toHaveBeenCalledTimes(1);
  });

  it('preserves results for formatting-only path edits with the same fingerprint', async () => {
    const { result, rerender } = renderFirestoreHook(tab.id);
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toEqual(rows));

    act(() => result.current.editDraft({ type: 'path-set', path: '/orders/' }));
    rerender();

    expect(result.current.activeDraft.path).toBe('/orders/');
    expect(result.current.queryRows).toEqual(rows);
    expect(result.current.activeQueryPath).toBe('orders');
  });

  it('rejects a late completion after an effective draft edit', async () => {
    const completion = deferred<
      { items: ReadonlyArray<FirestoreDocumentResult>; nextCursor: null; }
    >();
    const onQueryActivity = vi.fn();
    firestore.runQuery.mockReturnValue(completion.promise);
    const { result, rerender } = renderFirestoreHook(tab.id, { onQueryActivity });
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(firestore.runQuery).toHaveBeenCalledTimes(1));

    act(() => result.current.editDraft({ type: 'path-set', path: 'auditLogs' }));
    rerender();
    await act(async () => completion.resolve({ items: rows, nextCursor: null }));

    expect(result.current.activeDraft.path).toBe('auditLogs');
    expect(result.current.queryRows).toEqual([]);
    expect(onQueryActivity).not.toHaveBeenCalled();
  });

  it('keeps results isolated for tabs on the same collection', async () => {
    const secondTab = firestoreTab('tab-firestore-query-2', 'orders');
    tabActions.restore(tabsState([tab, secondTab], tab.id));
    firestore.runQuery.mockImplementation(async (query: FirestoreQuery) => ({
      items: query.filters?.some((filter) => filter.value === 'open') ? openRows : rows,
      nextCursor: null,
    }));
    let activeTabId = tab.id;
    const { rerender, result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: currentFirestoreTab(activeTabId),
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() =>
      result.current.editDraft({
        type: 'filter-add',
        filter: { id: 'status-paid', field: 'status', op: '==', value: '"paid"' },
      })
    );
    rerender();
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toEqual(rows));

    activeTabId = secondTab.id;
    rerender();
    act(() =>
      result.current.editDraft({
        type: 'filter-add',
        filter: { id: 'status-open', field: 'status', op: '==', value: '"open"' },
      })
    );
    rerender();
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toEqual(openRows));

    activeTabId = tab.id;
    rerender();

    expect(result.current.queryRows).toEqual(rows);
    expect(result.current.activeDraft.filters?.[0]?.value).toBe('"paid"');
  });

  it('keeps stale state scoped to each execution and clears it on rerun', () => {
    const secondTab = firestoreTab('tab-firestore-query-2', 'orders');
    tabActions.restore(tabsState([tab, secondTab], tab.id));
    let activeTabId = tab.id;
    const { rerender, result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: currentFirestoreTab(activeTabId),
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() => result.current.setResultsStale(tab.id, true));
    expect(result.current.resultsStale).toBe(true);

    activeTabId = secondTab.id;
    rerender();
    expect(result.current.resultsStale).toBe(false);

    act(() => result.current.setResultsStale(secondTab.id, true));
    expect(result.current.resultsStale).toBe(true);

    activeTabId = tab.id;
    rerender();
    expect(result.current.resultsStale).toBe(true);

    act(() => {
      result.current.runQuery();
    });
    expect(result.current.resultsStale).toBe(false);
  });

  it('stores result view and inspector UI in each Firestore tab', () => {
    const firstTab = firestoreTab('tab-firestore-query-1', 'orders', {
      inspectorUi: {
        ...defaultFirestoreInspectorUiState(),
        overviewCollapsed: true,
        resultView: 'tree',
        resultTreeExpandedIds: ['root:orders'],
      },
    });
    const secondTab = firestoreTab('tab-firestore-query-2', 'orders');
    tabActions.restore(tabsState([firstTab, secondTab], firstTab.id));
    let activeTabId = firstTab.id;
    const { rerender, result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: currentFirestoreTab(activeTabId),
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    expect(result.current.resultView).toBe('tree');
    expect(result.current.activeInspectorUi.overviewCollapsed).toBe(true);

    activeTabId = secondTab.id;
    rerender();
    act(() => result.current.setResultView(secondTab.id, 'json'));
    act(() => result.current.setInspectorOverviewCollapsed(secondTab.id, true));
    act(() => result.current.setInspectorSectionOpen(secondTab.id, 'selectionPreview', false));
    act(() =>
      result.current.setSelectionPreviewExpandedPaths(
        secondTab.id,
        'orders/ord_1025',
        ['["profile"]'],
      )
    );
    act(() => result.current.setResultTreeExpandedIds(secondTab.id, ['root:customers']));
    rerender();

    expect(result.current.activeInspectorUi).toMatchObject({
      overviewCollapsed: true,
      resultView: 'json',
      resultTreeExpandedIds: ['root:customers'],
      sections: { selectionPreview: false },
      selectionPreviewExpandedPathsByDocumentPath: {
        'orders/ord_1025': ['["profile"]'],
      },
    });

    activeTabId = firstTab.id;
    rerender();
    expect(result.current.activeInspectorUi).toMatchObject({
      overviewCollapsed: true,
      resultView: 'tree',
      resultTreeExpandedIds: ['root:orders'],
    });
  });

  it('keeps selected document scoped to current query rows', async () => {
    const { result } = renderFirestoreHook(tab.id);
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toHaveLength(1));

    act(() => result.current.selectDocument(tab.id, 'orders/ord_1024'));
    expect(result.current.selectedDocument?.id).toBe('ord_1024');
    expect(result.current.selectedDocumentPath).toBe('orders/ord_1024');

    act(() => result.current.selectDocument(tab.id, 'orders/missing'));
    expect(result.current.selectedDocument).toBeNull();
    expect(result.current.selectedDocumentPath).toBeNull();
  });

  it('refreshes loaded pages from the immutable submitted query and preserves selection', async () => {
    firestore.runQuery
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null })
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null });
    const { result } = renderFirestoreHook(tab.id);
    act(() => {
      expect(result.current.runQuery()).toBe('orders');
    });
    await waitFor(() => expect(result.current.activeLoadedPageCount).toBe(1));
    act(() => result.current.selectDocument(tab.id, 'orders/ord_1024'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.activeLoadedPageCount).toBe(2));

    act(() => {
      expect(result.current.refreshQuery()).toBe('orders');
    });

    await waitFor(() => expect(firestore.runQuery).toHaveBeenCalledTimes(4));
    expect(result.current.selectedDocumentPath).toBe('orders/ord_1024');
  });

  it('records multi-page refresh activity once after all pages load', async () => {
    const onQueryActivity = vi.fn();
    firestore.runQuery
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null })
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null });
    const { result } = renderFirestoreHook(tab.id, { onQueryActivity });

    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(onQueryActivity).toHaveBeenCalledTimes(1));
    onQueryActivity.mockClear();
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.activeLoadedPageCount).toBe(2));

    act(() => {
      expect(result.current.refreshQuery()).toBe('orders');
    });

    await waitFor(() => expect(onQueryActivity).toHaveBeenCalledTimes(1));
    expect(onQueryActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        loadedPages: 2,
        resultCount: 2,
      }),
    }));
  });
});

function renderFirestoreHook(
  tabId: string,
  options: {
    readonly onQueryActivity?: ((input: ActivityLogAppendInput) => void) | undefined;
  } = {},
) {
  return renderHook(() =>
    useFirestoreTabState({
      activeProject: project,
      activeTab: currentFirestoreTab(tabId),
      onQueryActivity: options.onQueryActivity,
      selectedTreeItemId: 'collection:emu:orders',
    })
  );
}

function firestoreTab(
  id: string,
  path: string,
  options: {
    readonly connectionId?: string | undefined;
    readonly inspectorUi?: ReturnType<typeof defaultFirestoreInspectorUiState> | undefined;
  } = {},
): WorkspaceTab {
  return {
    id,
    kind: 'firestore-query',
    connectionId: options.connectionId ?? 'emu',
    draft: createFirestoreDraft(path),
    inspectorUi: options.inspectorUi ?? defaultFirestoreInspectorUiState(),
    inspectorWidth: 360,
  };
}

function tabsState(tabs: ReadonlyArray<WorkspaceTab>, activeTabId: string) {
  return {
    activeTabId,
    interactionHistory: [],
    interactionHistoryIndex: -1,
    selectedTreeItemId: 'collection:emu:orders',
    tabs,
  };
}

function currentFirestoreTab(tabId: string) {
  const current = tabsStore.state.tabs.find((candidate) => candidate.id === tabId);
  if (!current || current.kind !== 'firestore-query') {
    throw new Error(`Missing Firestore tab ${tabId}`);
  }
  return current;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
