// @vitest-environment jsdom

import type {
  FirestoreDocumentResult,
  FirestoreQuery,
  ProjectSummary,
} from '@firebase-desk/repo-contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRepositories } from '../RepositoryProvider.tsx';
import { selectionActions } from '../stores/selectionStore.ts';
import { tabActions, type WorkspaceTab } from '../stores/tabsStore.ts';
import { DEFAULT_FIRESTORE_DRAFT } from '../workspaceModel.ts';
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

const tab: WorkspaceTab = {
  id: 'tab-firestore-query-1',
  kind: 'firestore-query',
  title: 'orders',
  connectionId: 'emu',
  history: ['orders'],
  historyIndex: 0,
  inspectorWidth: 360,
};

const rows: ReadonlyArray<FirestoreDocumentResult> = [
  { id: 'ord_1024', path: 'orders/ord_1024', data: { status: 'paid' }, hasSubcollections: false },
];

const openRows: ReadonlyArray<FirestoreDocumentResult> = [
  { id: 'ord_1025', path: 'orders/ord_1025', data: { status: 'open' }, hasSubcollections: false },
];

describe('useFirestoreTabState', () => {
  let firestore: {
    getDocument: ReturnType<typeof vi.fn>;
    runQuery: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    selectionActions.reset();
    firestore = {
      getDocument: vi.fn(async () => null),
      runQuery: vi.fn(async () => ({ items: rows, nextCursor: null })),
    };
    vi.mocked(useRepositories).mockReturnValue({ firestore } as never);
  });

  it('creates active drafts from tab history and updates drafts by active tab', () => {
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    expect(result.current.activeDraft.path).toBe('orders');

    act(() => result.current.setDraft({ ...DEFAULT_FIRESTORE_DRAFT, path: 'customers' }));

    expect(result.current.activeDraft.path).toBe('customers');
    expect(result.current.drafts[tab.id]?.path).toBe('customers');
  });

  it('submits query requests and records tab interaction', async () => {
    const pushHistory = vi.spyOn(tabActions, 'pushHistory').mockImplementation(() => {});
    const recordInteraction = vi.spyOn(tabActions, 'recordInteraction').mockImplementation(
      () => {},
    );
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    let path: string | null = null;
    act(() => {
      path = result.current.runQuery();
    });

    expect(path).toBe('orders');
    await waitFor(() =>
      expect(firestore.runQuery).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'emu', path: 'orders' }),
        expect.objectContaining({ limit: 25 }),
      )
    );
    expect(pushHistory).toHaveBeenCalledWith(tab.id, 'orders');
    expect(recordInteraction).toHaveBeenCalledWith({
      activeTabId: tab.id,
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
  });

  it('increments query run IDs so repeated runs do not reuse cached pages', () => {
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() => {
      result.current.runQuery();
    });
    act(() => {
      result.current.runQuery();
    });

    expect(result.current.activeQueryRunId).toBe(2);
  });

  it('loads document path queries through the repository', async () => {
    firestore.getDocument.mockResolvedValue(rows[0]);
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() => result.current.setDraft({ ...DEFAULT_FIRESTORE_DRAFT, path: 'orders/ord_1024' }));
    act(() => {
      result.current.runQuery();
    });

    await waitFor(() =>
      expect(firestore.getDocument).toHaveBeenCalledWith('emu', 'orders/ord_1024')
    );
  });

  it('keeps current query rows while editing draft controls', async () => {
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toEqual(rows));

    act(() => result.current.setDraft({ ...result.current.activeDraft, limit: 1 }));

    expect(result.current.queryRows).toEqual(rows);
    expect(firestore.runQuery).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.runQuery();
    });

    await waitFor(() => expect(firestore.runQuery).toHaveBeenCalledTimes(2));
    expect(firestore.runQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectionId: 'emu', path: 'orders' }),
      expect.objectContaining({ limit: 1 }),
    );
  });

  it('keeps query results isolated for multiple tabs on the same collection', async () => {
    const secondTab: WorkspaceTab = { ...tab, id: 'tab-firestore-query-2' };
    firestore.runQuery.mockImplementation(async (query: FirestoreQuery) => ({
      items: query.filters?.some((filter) => filter.value === 'open') ? openRows : rows,
      nextCursor: null,
    }));
    let activeTab = tab;
    const { rerender, result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() =>
      result.current.setDraft({
        ...result.current.activeDraft,
        filters: [{ id: 'status-paid', field: 'status', op: '==', value: '"paid"' }],
      })
    );
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toEqual(rows));

    activeTab = secondTab;
    rerender();
    act(() =>
      result.current.setDraft({
        ...result.current.activeDraft,
        filters: [{ id: 'status-open', field: 'status', op: '==', value: '"open"' }],
      })
    );
    act(() => {
      result.current.runQuery();
    });
    await waitFor(() => expect(result.current.queryRows).toEqual(openRows));

    activeTab = tab;
    rerender();

    expect(result.current.queryRows).toEqual(rows);
    expect(result.current.activeDraft.filters?.[0]?.value).toBe('"paid"');
  });

  it('keeps results changed state scoped to the query tab and clears it on rerun', () => {
    const secondTab: WorkspaceTab = { ...tab, id: 'tab-firestore-query-2' };
    let activeTab = tab;
    const { rerender, result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() => result.current.setResultsStale(tab.id, true));

    expect(result.current.resultsStale).toBe(true);

    activeTab = secondTab;
    rerender();

    expect(result.current.resultsStale).toBe(false);

    act(() => result.current.setResultsStale(secondTab.id, true));

    expect(result.current.resultsStale).toBe(true);

    activeTab = tab;
    rerender();

    expect(result.current.resultsStale).toBe(true);

    act(() => {
      result.current.runQuery();
    });

    expect(result.current.resultsStale).toBe(false);
  });

  it('keeps result view scoped to the query tab and preserves it on rerun', () => {
    const secondTab: WorkspaceTab = { ...tab, id: 'tab-firestore-query-2' };
    let activeTab = tab;
    const { rerender, result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    act(() => result.current.setResultView(tab.id, 'tree'));

    expect(result.current.resultView).toBe('tree');

    activeTab = secondTab;
    rerender();

    expect(result.current.resultView).toBe('table');

    act(() => result.current.setResultView(secondTab.id, 'json'));

    expect(result.current.resultView).toBe('json');

    activeTab = tab;
    rerender();

    expect(result.current.resultView).toBe('tree');

    act(() => {
      result.current.runQuery();
    });

    expect(result.current.resultView).toBe('tree');
  });

  it('keeps inspector UI state scoped to the query tab', () => {
    const secondTab: WorkspaceTab = { ...tab, id: 'tab-firestore-query-2' };
    const initialInspectorUi = {
      [tab.id]: {
        overviewCollapsed: true,
        resultTreeExpandedIds: ['root:orders'],
        sections: {
          fieldsInResults: true,
          jsonContext: true,
          selectionPreview: false,
        },
        selectionPreviewExpandedPathsByDocumentPath: {
          'orders/ord_1024': ['["customer"]'],
        },
      },
    };
    let activeTab = tab;
    const { rerender, result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab,
        initialInspectorUi,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

    expect(result.current.activeInspectorUi.overviewCollapsed).toBe(true);
    expect(result.current.activeInspectorUi.sections.fieldsInResults).toBe(true);

    activeTab = secondTab;
    rerender();

    expect(result.current.activeInspectorUi.overviewCollapsed).toBe(false);

    act(() => result.current.setInspectorOverviewCollapsed(secondTab.id, true));
    act(() => result.current.setInspectorSectionOpen(secondTab.id, 'selectionPreview', false));
    act(() =>
      result.current.setSelectionPreviewExpandedPaths(secondTab.id, 'orders/ord_1025', [
        '["profile"]',
      ])
    );
    act(() => result.current.setResultTreeExpandedIds(secondTab.id, ['root:customers']));

    expect(result.current.activeInspectorUi).toMatchObject({
      overviewCollapsed: true,
      resultTreeExpandedIds: ['root:customers'],
      sections: { selectionPreview: false },
      selectionPreviewExpandedPathsByDocumentPath: {
        'orders/ord_1025': ['["profile"]'],
      },
    });

    activeTab = tab;
    rerender();

    expect(result.current.activeInspectorUi).toMatchObject({
      overviewCollapsed: true,
      resultTreeExpandedIds: ['root:orders'],
      selectionPreviewExpandedPathsByDocumentPath: {
        'orders/ord_1024': ['["customer"]'],
      },
    });
  });

  it('keeps selected document scoped to current query rows', async () => {
    tabActions.restore({
      activeTabId: tab.id,
      interactionHistory: [],
      interactionHistoryIndex: 0,
      tabs: [tab],
    });
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );
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

  it('refreshes from page one, reloads loaded page count, and preserves selection', async () => {
    firestore.runQuery
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null })
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null });
    tabActions.restore({
      activeTabId: tab.id,
      interactionHistory: [],
      interactionHistoryIndex: 0,
      tabs: [tab],
    });
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );
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

  it('records multi-page refresh activity once after all requested pages load', async () => {
    const onQueryActivity = vi.fn();
    firestore.runQuery
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null })
      .mockResolvedValueOnce({ items: rows, nextCursor: { token: 'page-2' } })
      .mockResolvedValueOnce({ items: rows, nextCursor: null });
    const { result } = renderHook(() =>
      useFirestoreTabState({
        activeProject: project,
        activeTab: tab,
        onQueryActivity,
        selectedTreeItemId: 'collection:emu:orders',
      })
    );

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
