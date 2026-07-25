import type {
  ActivityLogAppendInput,
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreQuery,
  FirestoreQueryDraft,
  FirestoreQueryDraftEdit,
  PageRequest,
  ProjectSummary,
} from '@firebase-desk/repo-contracts';
import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import { useRef, useState } from 'react';
import {
  completeFirestoreSubcollectionsLoadCommand,
  executeFirestoreLoadMoreCommand,
  executeFirestoreQueryCommand,
  failFirestoreSubcollectionsLoadCommand,
  loadMoreFirestoreQueryCommand,
  refreshFirestoreQueryCommand,
  runFirestoreQueryCommand,
  startFirestoreSubcollectionsLoadCommand,
} from '../../app-core/firestore/query/firestoreQueryCommands.ts';
import {
  applyFirestoreDraftEdit,
  firestoreDraftFingerprint,
} from '../../app-core/firestore/query/firestoreQueryDraft.ts';
import {
  selectFirestoreActiveQueryRequest,
  selectFirestoreLoadedPageCount,
  selectFirestoreResultExecution,
  selectFirestoreResultRows,
  selectFirestoreSelectedDocument,
  selectFirestoreTabResultState,
} from '../../app-core/firestore/query/firestoreQuerySelectors.ts';
import {
  createInitialFirestoreQueryRuntimeState,
  defaultFirestoreInspectorUiState,
  type FirestoreInspectorSectionId,
  type FirestoreInspectorUiState,
  type FirestoreQueryRuntimeState,
  type FirestoreResultView,
  type SubmittedFirestoreQuery,
  type SubmittedFirestoreSubcollectionLoad,
} from '../../app-core/firestore/query/firestoreQueryState.ts';
import {
  firestoreCollectionJobSucceeded,
  firestoreDocumentSelected,
  firestoreResultDocumentDeleted,
  firestoreResultDocumentSaved,
  firestoreResultsMarkedStale,
  firestoreResultsRefreshed,
  firestoreTabCleared,
  firestoreTabRuntimeInvalidated,
} from '../../app-core/firestore/query/firestoreQueryTransitions.ts';
import { useRepositories } from '../RepositoryProvider.tsx';
import { tabActions, tabsStore, type WorkspaceTab } from '../stores/tabsStore.ts';
import { DEFAULT_FIRESTORE_DRAFT, draftToQuery, isDocumentPath } from '../workspaceModel.ts';

interface UseFirestoreTabStateInput {
  readonly activeProject: ProjectSummary | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly onQueryActivity?: ((input: ActivityLogAppendInput) => void) | undefined;
  readonly selectedTreeItemId: string | null;
}

export interface FirestoreTabState {
  readonly activeLoadedPageCount: number;
  readonly activeDraft: FirestoreQueryDraft;
  readonly activeInspectorUi: FirestoreInspectorUiState;
  readonly activeQueryIsDocument: boolean;
  readonly activeQueryConnectionId: string | null;
  readonly activeQueryPath: string | null;
  readonly activeQueryRunId: number | null;
  readonly activeResultExecution: SubmittedFirestoreQuery | null;
  readonly errorMessage: string | null;
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly isLoading: boolean;
  readonly isTabLoading: (tabId: string) => boolean;
  readonly queryRows: ReadonlyArray<FirestoreDocumentResult>;
  readonly resultView: FirestoreResultView;
  readonly resultsStale: boolean;
  readonly selectedDocument: FirestoreDocumentResult | null;
  readonly selectedDocumentPath: string | null;
  readonly clearTab: (tabId: string) => void;
  readonly duplicateTab: (sourceTabId: string, targetTabId: string) => void;
  readonly editDraft: (edit: FirestoreQueryDraftEdit) => void;
  readonly invalidateTab: (tabId: string) => void;
  readonly loadMore: () => void;
  readonly markCollectionJobSucceeded: (job: BackgroundJob) => void;
  readonly loadSubcollections: (
    documentPath: string,
  ) => Promise<ReadonlyArray<FirestoreCollectionNode>>;
  readonly openTab: (connectionId: string, path: string) => string;
  readonly openTabInNewTab: (connectionId: string, path: string) => string;
  readonly refreshQuery: () => string | null;
  readonly runQuery: () => string | null;
  readonly selectDocument: (tabId: string, path: string | null) => void;
  readonly removeResultDocument: (
    execution: SubmittedFirestoreQuery,
    documentPath: string,
  ) => void;
  readonly replaceResultDocument: (
    execution: SubmittedFirestoreQuery,
    document: FirestoreDocumentResult,
  ) => void;
  readonly setInspectorOverviewCollapsed: (tabId: string, collapsed: boolean) => void;
  readonly setInspectorSectionOpen: (
    tabId: string,
    section: FirestoreInspectorSectionId,
    open: boolean,
  ) => void;
  readonly setResultTreeExpandedIds: (
    tabId: string,
    expandedIds: ReadonlyArray<string>,
  ) => void;
  readonly setResultView: (tabId: string, resultView: FirestoreResultView) => void;
  readonly setResultsStale: (tabId: string, stale: boolean) => void;
  readonly setSelectionPreviewExpandedPaths: (
    tabId: string,
    documentPath: string,
    expandedPaths: ReadonlyArray<string>,
  ) => void;
}

export function useFirestoreTabState(
  {
    activeProject,
    activeTab,
    onQueryActivity,
    selectedTreeItemId,
  }: UseFirestoreTabStateInput,
): FirestoreTabState {
  const repositories = useRepositories();
  const [queryState, setQueryState] = useState(createInitialFirestoreQueryRuntimeState);
  const queryStateRef = useRef(queryState);
  queryStateRef.current = queryState;

  function updateQueryState(
    update:
      | FirestoreQueryRuntimeState
      | ((current: FirestoreQueryRuntimeState) => FirestoreQueryRuntimeState),
  ): void {
    const next = typeof update === 'function' ? update(queryStateRef.current) : update;
    queryStateRef.current = next;
    setQueryState(next);
  }

  const queryCommandStore = {
    get: () => queryStateRef.current,
    set: updateQueryState,
    subscribe: () => () => undefined,
    update: updateQueryState,
  };
  const queryExecutionEnv = {
    getDocument: (connectionId: string, path: string) =>
      repositories.firestore.getDocument(connectionId, path),
    now: Date.now,
    recordActivity: onQueryActivity,
    runQuery: (query: FirestoreQuery, request: PageRequest) =>
      repositories.firestore.runQuery(query, request),
  };

  const activeDraft = activeTab?.kind === 'firestore-query'
    ? activeTab.draft
    : DEFAULT_FIRESTORE_DRAFT;
  const activeInspectorUi = activeTab?.kind === 'firestore-query'
    ? activeTab.inspectorUi
    : defaultFirestoreInspectorUiState();
  const activeQueryRequest = selectFirestoreActiveQueryRequest(
    queryState,
    activeTab,
    activeTab?.connectionId,
  );
  const resultExecution = selectFirestoreResultExecution(queryState, activeTab);
  const submittedQuery = resultExecution?.query ?? null;
  const queryRequestIsDocument = submittedQuery ? isDocumentPath(submittedQuery.path) : false;
  const activeResult = selectFirestoreTabResultState(queryState, activeTab);
  const queryRows = resultExecution ? selectFirestoreResultRows(activeResult.pages) : [];
  const activeSelectedDocumentPath = activeTab?.kind === 'firestore-query'
    ? queryState.selectedDocumentPaths[activeTab.id] ?? null
    : null;
  const selectedDocument = selectFirestoreSelectedDocument(queryRows, activeSelectedDocumentPath);
  const selectedDocumentPath = selectedDocument?.path ?? null;
  const activeLoadedPageCount = selectFirestoreLoadedPageCount(
    activeResult.pages,
    queryRequestIsDocument,
    queryRows.length > 0,
  );

  function editDraft(edit: FirestoreQueryDraftEdit) {
    const tab = currentFirestoreTab(activeTab?.id);
    if (!tab) return;
    const nextDraft = applyFirestoreDraftEdit(tab.draft, edit);
    if (
      firestoreDraftFingerprint(tab.connectionId, tab.draft)
        !== firestoreDraftFingerprint(tab.connectionId, nextDraft)
    ) {
      invalidateTab(tab.id);
    }
    tabActions.editFirestoreDraft(tab.id, edit);
  }

  function setInspectorOverviewCollapsed(tabId: string, collapsed: boolean) {
    updateInspectorUi(tabId, (current) => ({ ...current, overviewCollapsed: collapsed }));
  }

  function setInspectorSectionOpen(
    tabId: string,
    section: FirestoreInspectorSectionId,
    open: boolean,
  ) {
    updateInspectorUi(tabId, (current) => ({
      ...current,
      sections: { ...current.sections, [section]: open },
    }));
  }

  function setSelectionPreviewExpandedPaths(
    tabId: string,
    documentPath: string,
    expandedPaths: ReadonlyArray<string>,
  ) {
    updateInspectorUi(tabId, (current) => ({
      ...current,
      selectionPreviewExpandedPathsByDocumentPath: {
        ...current.selectionPreviewExpandedPathsByDocumentPath,
        [documentPath]: expandedPaths,
      },
    }));
  }

  function setResultTreeExpandedIds(tabId: string, expandedIds: ReadonlyArray<string>) {
    updateInspectorUi(tabId, (current) => ({ ...current, resultTreeExpandedIds: expandedIds }));
  }

  function setResultView(tabId: string, resultView: FirestoreResultView) {
    updateInspectorUi(tabId, (current) => ({ ...current, resultView }));
  }

  function updateInspectorUi(
    tabId: string,
    update: (current: FirestoreInspectorUiState) => FirestoreInspectorUiState,
  ) {
    const tab = currentFirestoreTab(tabId);
    if (!tab) return;
    tabActions.setFirestoreInspectorUi(tabId, update(tab.inspectorUi));
  }

  function runQuery(): string | null {
    return submitQuery({ clearSelection: true, pagesToReload: null });
  }

  function refreshQuery(): string | null {
    const result = selectFirestoreTabResultState(queryStateRef.current, activeTab);
    const execution = result.execution;
    const isDocument = execution ? isDocumentPath(execution.query.path) : false;
    const rows = selectFirestoreResultRows(result.pages);
    return submitQuery({
      clearSelection: false,
      pagesToReload: Math.max(
        1,
        selectFirestoreLoadedPageCount(result.pages, isDocument, rows.length > 0) || 1,
      ),
    });
  }

  function submitQuery(
    {
      clearSelection,
      pagesToReload,
    }: {
      readonly clearSelection: boolean;
      readonly pagesToReload: number | null;
    },
  ): string | null {
    const tab = currentFirestoreTab(activeTab?.id);
    if (!tab || !activeProject || tab.connectionId !== activeProject.id) return null;
    const state = queryStateRef.current;
    const currentExecution = pagesToReload === null
      ? null
      : selectFirestoreResultExecution(state, tab);
    const submittedDraft = currentExecution?.draft ?? tab.draft;
    const nextQuery = currentExecution?.query ?? draftToQuery(tab.connectionId, submittedDraft);
    const result = pagesToReload === null
      ? runFirestoreQueryCommand(state, {
        activeDraft: submittedDraft,
        clearSelection,
        query: nextQuery,
        selectedTreeItemId,
        tab,
      })
      : refreshFirestoreQueryCommand(state, {
        activeDraft: submittedDraft,
        clearSelection,
        pagesToReload,
        query: nextQuery,
        selectedTreeItemId,
        tab,
      });
    updateQueryState(result.state);
    tabActions.recordInteraction({
      activeTabId: tab.id,
      selectedTreeItemId,
    });
    const request = result.state.queryRequests[tab.id] ?? null;
    if (request) {
      void executeFirestoreQueryCommand(queryCommandStore, queryExecutionEnv, {
        draft: request.draft,
        isRefresh: pagesToReload !== null,
        pagesToLoad: pagesToReload ?? 1,
        request,
        tab,
      });
    }
    return result.path;
  }

  function openTab(connectionId: string, path: string): string {
    return tabActions.openFirestoreTarget({ connectionId, newTab: false, path });
  }

  function openTabInNewTab(connectionId: string, path: string): string {
    return tabActions.openFirestoreTarget({ connectionId, newTab: true, path });
  }

  function invalidateTab(tabId: string) {
    updateQueryState((current) => firestoreTabRuntimeInvalidated(current, tabId));
  }

  function clearTab(tabId: string) {
    updateQueryState((current) => firestoreTabCleared(current, tabId));
  }

  function duplicateTab(_sourceTabId: string, targetTabId: string) {
    invalidateTab(targetTabId);
  }

  function selectDocument(tabId: string, path: string | null) {
    updateQueryState((current) => firestoreDocumentSelected(current, tabId, path));
  }

  function replaceResultDocument(
    execution: SubmittedFirestoreQuery,
    document: FirestoreDocumentResult,
  ) {
    updateQueryState((current) => firestoreResultDocumentSaved(current, execution, document));
  }

  function removeResultDocument(
    execution: SubmittedFirestoreQuery,
    documentPath: string,
  ) {
    updateQueryState((current) => firestoreResultDocumentDeleted(current, execution, documentPath));
  }

  function setResultsStale(tabId: string, stale: boolean) {
    updateQueryState((current) =>
      stale
        ? firestoreResultsMarkedStale(current, tabId)
        : firestoreResultsRefreshed(current, tabId)
    );
  }

  function markCollectionJobSucceeded(job: BackgroundJob) {
    updateQueryState((current) => firestoreCollectionJobSucceeded(current, job));
  }

  function loadMore() {
    const tab = currentFirestoreTab(activeTab?.id);
    if (!tab) return;
    const state = queryStateRef.current;
    const execution = selectFirestoreResultExecution(state, tab);
    if (!execution) return;
    const result = loadMoreFirestoreQueryCommand(state, {
      isDocumentQuery: isDocumentPath(execution.query.path),
      tabId: tab.id,
    });
    updateQueryState(result.state);
    if (result.shouldFetchNextPage) {
      void executeFirestoreLoadMoreCommand(queryCommandStore, queryExecutionEnv, {
        request: execution,
        tab,
      });
    }
  }

  async function loadSubcollections(
    documentPath: string,
  ): Promise<ReadonlyArray<FirestoreCollectionNode>> {
    const tab = currentFirestoreTab(activeTab?.id);
    if (!tab) return [];
    const execution = selectFirestoreResultExecution(queryStateRef.current, tab);
    if (!execution) return [];
    const started = startFirestoreSubcollectionsLoadCommand(queryStateRef.current, {
      documentPath,
      execution,
    });
    if (!started.request) return [];
    updateQueryState(started.state);
    try {
      const subcollections = await repositories.firestore.listSubcollections(
        execution.query.connectionId,
        documentPath,
      );
      const accepted = completeSubcollectionsRequest(started.request, subcollections);
      return accepted ? subcollections : [];
    } catch (error) {
      updateQueryState((current) =>
        failFirestoreSubcollectionsLoadCommand(current, started.request!)
      );
      throw error;
    }
  }

  function completeSubcollectionsRequest(
    request: SubmittedFirestoreSubcollectionLoad,
    subcollections: ReadonlyArray<FirestoreCollectionNode>,
  ): boolean {
    let accepted = false;
    updateQueryState((current) => {
      const next = completeFirestoreSubcollectionsLoadCommand(current, {
        request,
        subcollections,
      });
      accepted = next !== current;
      return next;
    });
    return accepted;
  }

  function currentFirestoreTab(tabId: string | undefined) {
    const tab = tabsStore.state.tabs.find((item) => item.id === tabId);
    return tab?.kind === 'firestore-query' ? tab : null;
  }

  function isTabLoading(tabId: string): boolean {
    const result = queryState.resultsByTab[tabId];
    return Boolean(result?.status === 'loading' || result?.isFetchingMore);
  }

  return {
    activeDraft,
    activeInspectorUi,
    activeLoadedPageCount,
    activeQueryIsDocument: queryRequestIsDocument,
    activeQueryConnectionId: resultExecution?.query.connectionId ?? null,
    activeQueryPath: submittedQuery?.path ?? null,
    activeQueryRunId: activeQueryRequest?.runId ?? null,
    activeResultExecution: resultExecution,
    clearTab,
    duplicateTab,
    editDraft,
    errorMessage: activeResult.errorMessage,
    hasMore: !queryRequestIsDocument && activeResult.hasMore,
    invalidateTab,
    isFetchingMore: !queryRequestIsDocument && activeResult.isFetchingMore,
    isLoading: activeResult.status === 'loading',
    isTabLoading,
    loadMore,
    loadSubcollections,
    markCollectionJobSucceeded,
    openTab,
    openTabInNewTab,
    queryRows,
    refreshQuery,
    removeResultDocument,
    replaceResultDocument,
    resultView: activeInspectorUi.resultView,
    resultsStale: activeResult.resultsStale,
    runQuery,
    selectDocument,
    selectedDocument,
    selectedDocumentPath,
    setInspectorOverviewCollapsed,
    setInspectorSectionOpen,
    setResultTreeExpandedIds,
    setResultView,
    setResultsStale,
    setSelectionPreviewExpandedPaths,
  };
}
