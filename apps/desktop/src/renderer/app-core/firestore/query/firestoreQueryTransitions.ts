import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import type {
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreQuery,
} from '@firebase-desk/repo-contracts';
import type {
  FirestoreInspectorSectionId,
  FirestoreInspectorUiState,
  FirestoreQueryPage,
  FirestoreQueryResultState,
  FirestoreQueryRuntimeState,
  FirestoreResultView,
  SubmittedFirestoreQuery,
} from './firestoreQueryState.ts';
import {
  defaultFirestoreInspectorUiState,
  emptyFirestoreQueryResultState,
} from './firestoreQueryState.ts';

export function firestoreDraftChanged(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  draft: FirestoreQueryDraft,
): FirestoreQueryRuntimeState {
  return { ...state, drafts: { ...state.drafts, [tabId]: draft } };
}

export function firestoreTabDuplicated(
  state: FirestoreQueryRuntimeState,
  sourceTabId: string,
  targetTabId: string,
): FirestoreQueryRuntimeState {
  const sourceDraft = state.drafts[sourceTabId];
  const sourceResult = state.resultsByTab[sourceTabId];
  return {
    ...state,
    ...(sourceDraft === undefined
      ? {}
      : { drafts: { ...state.drafts, [targetTabId]: sourceDraft } }),
    ...(sourceResult === undefined
      ? {}
      : {
        resultsByTab: {
          ...state.resultsByTab,
          [targetTabId]: emptyFirestoreQueryResultStateWithView(sourceResult.resultView),
        },
      }),
  };
}

export function firestoreQueryStarted(
  state: FirestoreQueryRuntimeState,
  input: {
    readonly clearSelection: boolean;
    readonly limit: number;
    readonly query: FirestoreQuery;
    readonly runId?: number | undefined;
    readonly tabId: string;
  },
): FirestoreQueryRuntimeState {
  const runId = input.runId ?? state.nextRunId;
  return updateTabResult(
    {
      ...state,
      nextRunId: Math.max(state.nextRunId, runId + 1),
      pendingPageReloads: omitKey(state.pendingPageReloads, input.tabId),
      queryRequests: {
        ...state.queryRequests,
        [input.tabId]: { limit: input.limit, query: input.query, runId },
      },
      selectedDocumentPaths: input.clearSelection
        ? omitKey(state.selectedDocumentPaths, input.tabId)
        : state.selectedDocumentPaths,
    },
    input.tabId,
    (current) => ({
      ...emptyFirestoreQueryResultState(),
      isLoading: true,
      resultView: current.resultView,
    }),
  );
}

export function firestoreQuerySucceeded(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  pages: ReadonlyArray<FirestoreQueryPage>,
  hasMore = false,
): FirestoreQueryRuntimeState {
  return updateTabResult(state, tabId, (current) => ({
    ...current,
    errorMessage: null,
    hasMore,
    isFetchingMore: false,
    isLoading: false,
    pages,
  }));
}

export function firestoreQueryFailed(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  message: string,
): FirestoreQueryRuntimeState {
  return updateTabResult(state, tabId, (current) => ({
    ...current,
    errorMessage: message,
    isFetchingMore: false,
    isLoading: false,
  }));
}

export function firestoreLoadMoreStarted(
  state: FirestoreQueryRuntimeState,
  tabId: string,
): FirestoreQueryRuntimeState {
  return updateTabResult(state, tabId, (current) => ({ ...current, isFetchingMore: true }));
}

export function firestoreLoadMoreSucceeded(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  page: FirestoreQueryPage,
  hasMore = false,
): FirestoreQueryRuntimeState {
  return updateTabResult(state, tabId, (current) => ({
    ...current,
    hasMore,
    isFetchingMore: false,
    pages: [...current.pages, page],
  }));
}

export function firestoreLoadMoreFailed(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  message: string,
): FirestoreQueryRuntimeState {
  return updateTabResult(state, tabId, (current) => ({
    ...current,
    errorMessage: message,
    isFetchingMore: false,
  }));
}

export function firestoreRefreshStarted(
  state: FirestoreQueryRuntimeState,
  input: {
    readonly limit: number;
    readonly pagesToReload: number;
    readonly query: FirestoreQuery;
    readonly runId?: number | undefined;
    readonly tabId: string;
  },
): FirestoreQueryRuntimeState {
  const started = firestoreQueryStarted(state, {
    clearSelection: false,
    limit: input.limit,
    query: input.query,
    runId: input.runId,
    tabId: input.tabId,
  });
  return {
    ...started,
    pendingPageReloads: { ...started.pendingPageReloads, [input.tabId]: input.pagesToReload },
  };
}

export function firestoreRefreshSucceeded(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  pages: ReadonlyArray<FirestoreQueryPage>,
  hasMore = false,
): FirestoreQueryRuntimeState {
  return {
    ...firestoreQuerySucceeded(state, tabId, pages, hasMore),
    pendingPageReloads: omitKey(state.pendingPageReloads, tabId),
  };
}

export function firestoreResultViewChanged(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  resultView: FirestoreResultView,
): FirestoreQueryRuntimeState {
  return updateTabResult(state, tabId, (current) => ({ ...current, resultView }));
}

export function firestoreDocumentSelected(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  path: string | null,
): FirestoreQueryRuntimeState {
  return {
    ...state,
    selectedDocumentPaths: path === null
      ? omitKey(state.selectedDocumentPaths, tabId)
      : { ...state.selectedDocumentPaths, [tabId]: path },
  };
}

export function firestoreInspectorOverviewCollapsedChanged(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  overviewCollapsed: boolean,
): FirestoreQueryRuntimeState {
  return updateTabInspectorUi(state, tabId, (current) => ({ ...current, overviewCollapsed }));
}

export function firestoreInspectorSectionChanged(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  section: FirestoreInspectorSectionId,
  open: boolean,
): FirestoreQueryRuntimeState {
  return updateTabInspectorUi(state, tabId, (current) => ({
    ...current,
    sections: { ...current.sections, [section]: open },
  }));
}

export function firestoreSelectionPreviewExpandedPathsChanged(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  documentPath: string,
  expandedPaths: ReadonlyArray<string>,
): FirestoreQueryRuntimeState {
  return updateTabInspectorUi(state, tabId, (current) => ({
    ...current,
    selectionPreviewExpandedPathsByDocumentPath: {
      ...current.selectionPreviewExpandedPathsByDocumentPath,
      [documentPath]: expandedPaths,
    },
  }));
}

export function firestoreResultTreeExpandedIdsChanged(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  expandedIds: ReadonlyArray<string>,
): FirestoreQueryRuntimeState {
  return updateTabInspectorUi(state, tabId, (current) => ({
    ...current,
    resultTreeExpandedIds: expandedIds,
  }));
}

export function firestoreSubcollectionsLoaded(
  state: FirestoreQueryRuntimeState,
  documentPath: string,
  subcollections: ReadonlyArray<FirestoreCollectionNode>,
): FirestoreQueryRuntimeState {
  return {
    ...state,
    resultsByTab: Object.fromEntries(
      Object.entries(state.resultsByTab).map(([tabId, result]) => [
        tabId,
        {
          ...result,
          pages: mergeSubcollectionsIntoPages(result.pages, documentPath, subcollections),
        },
      ]),
    ),
  };
}

export function firestoreResultDocumentSaved(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  document: FirestoreDocumentResult,
): FirestoreQueryRuntimeState {
  return updateTabResult(state, tabId, (current) => ({
    ...current,
    pages: replaceDocumentInPages(current.pages, document),
  }));
}

export function firestoreResultDocumentDeleted(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  documentPath: string,
): FirestoreQueryRuntimeState {
  return {
    ...updateTabResult(state, tabId, (current) => ({
      ...current,
      pages: removeDocumentFromPages(current.pages, documentPath),
    })),
    selectedDocumentPaths: shouldClearSelectedDocument(
        state.selectedDocumentPaths[tabId] ?? null,
        documentPath,
      )
      ? omitKey(state.selectedDocumentPaths, tabId)
      : state.selectedDocumentPaths,
  };
}

function mergeSubcollectionsIntoPages(
  pages: ReadonlyArray<FirestoreQueryPage>,
  documentPath: string,
  subcollections: ReadonlyArray<FirestoreCollectionNode>,
): ReadonlyArray<FirestoreQueryPage> {
  return pages.map((page) => ({
    items: page.items.map((document) =>
      document.path === documentPath ? { ...document, subcollections } : document
    ),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  }));
}

function replaceDocumentInPages(
  pages: ReadonlyArray<FirestoreQueryPage>,
  replacement: FirestoreDocumentResult,
): ReadonlyArray<FirestoreQueryPage> {
  return pages.map((page) => ({
    ...page,
    items: replaceDocumentInRows(page.items, replacement),
  }));
}

function replaceDocumentInRows(
  documents: ReadonlyArray<FirestoreDocumentResult>,
  replacement: FirestoreDocumentResult,
): ReadonlyArray<FirestoreDocumentResult> {
  return documents.map((document) => {
    if (document.path === replacement.path) {
      return mergeSavedDocument(document, replacement);
    }
    const subcollections = replaceDocumentInSubcollections(document.subcollections, replacement);
    return subcollections === document.subcollections
      ? document
      : withSubcollections(document, subcollections);
  });
}

function replaceDocumentInSubcollections(
  subcollections: ReadonlyArray<FirestoreCollectionNode> | undefined,
  replacement: FirestoreDocumentResult,
): ReadonlyArray<FirestoreCollectionNode> | undefined {
  if (!subcollections) return subcollections;
  return subcollections.map((collection) => {
    const documents = documentsForCollection(collection);
    if (!documents) return collection;
    const nextDocuments = replaceDocumentInRows(documents, replacement);
    return nextDocuments === documents
      ? collection
      : withCollectionDocuments(collection, nextDocuments);
  });
}

function mergeSavedDocument(
  current: FirestoreDocumentResult,
  replacement: FirestoreDocumentResult,
): FirestoreDocumentResult {
  if (!current.subcollections?.length) return replacement;
  const replacementSubcollections = replacement.subcollections ?? [];
  if (!replacementSubcollections.length) {
    return {
      ...replacement,
      hasSubcollections: true,
      subcollections: current.subcollections,
    };
  }
  const loadedByPath = new Map(
    current.subcollections
      .filter((collection) => documentsForCollection(collection))
      .map((collection) => [collection.path, collection]),
  );
  return {
    ...replacement,
    subcollections: replacementSubcollections.map((collection) => {
      const loaded = loadedByPath.get(collection.path);
      const documents = loaded ? documentsForCollection(loaded) : undefined;
      return documents ? withCollectionDocuments(collection, documents) : collection;
    }),
  };
}

function removeDocumentFromPages(
  pages: ReadonlyArray<FirestoreQueryPage>,
  documentPath: string,
): ReadonlyArray<FirestoreQueryPage> {
  return pages.map((page) => ({
    ...page,
    items: removeDocumentFromRows(page.items, documentPath),
  }));
}

function removeDocumentFromRows(
  documents: ReadonlyArray<FirestoreDocumentResult>,
  documentPath: string,
): ReadonlyArray<FirestoreDocumentResult> {
  return documents
    .filter((document) => document.path !== documentPath)
    .map((document) => {
      const subcollections = removeDocumentFromSubcollections(
        document.subcollections,
        documentPath,
      );
      return subcollections === document.subcollections
        ? document
        : withSubcollections(document, subcollections);
    });
}

function removeDocumentFromSubcollections(
  subcollections: ReadonlyArray<FirestoreCollectionNode> | undefined,
  documentPath: string,
): ReadonlyArray<FirestoreCollectionNode> | undefined {
  if (!subcollections) return subcollections;
  return subcollections.map((collection) => {
    const documents = documentsForCollection(collection);
    if (!documents) return collection;
    const nextDocuments = removeDocumentFromRows(documents, documentPath);
    return nextDocuments === documents
      ? collection
      : withCollectionDocuments(collection, nextDocuments);
  });
}

function documentsForCollection(
  collection: FirestoreCollectionNode,
): ReadonlyArray<FirestoreDocumentResult> | undefined {
  return (collection as FirestoreCollectionNode & {
    readonly documents?: ReadonlyArray<FirestoreDocumentResult>;
  }).documents;
}

function withSubcollections(
  document: FirestoreDocumentResult,
  subcollections: ReadonlyArray<FirestoreCollectionNode> | undefined,
): FirestoreDocumentResult {
  return subcollections ? { ...document, subcollections } : document;
}

function withCollectionDocuments(
  collection: FirestoreCollectionNode,
  documents: ReadonlyArray<FirestoreDocumentResult>,
): FirestoreCollectionNode & { readonly documents: ReadonlyArray<FirestoreDocumentResult>; } {
  return { ...collection, documents };
}

function shouldClearSelectedDocument(
  selectedDocumentPath: string | null,
  deletedDocumentPath: string,
): boolean {
  return selectedDocumentPath === deletedDocumentPath
    || Boolean(selectedDocumentPath?.startsWith(`${deletedDocumentPath}/`));
}

export function firestoreResultsMarkedStale(
  state: FirestoreQueryRuntimeState,
  tabId?: string | undefined,
): FirestoreQueryRuntimeState {
  if (tabId) {
    return updateTabResult(state, tabId, (current) => ({ ...current, resultsStale: true }));
  }
  return updateAllTabResults(state, (current) => ({ ...current, resultsStale: true }));
}

export function firestoreResultsRefreshed(
  state: FirestoreQueryRuntimeState,
  tabId?: string | undefined,
): FirestoreQueryRuntimeState {
  if (tabId) {
    return updateTabResult(state, tabId, (current) => ({ ...current, resultsStale: false }));
  }
  return updateAllTabResults(state, (current) => ({ ...current, resultsStale: false }));
}

export function firestorePendingPageReloadCleared(
  state: FirestoreQueryRuntimeState,
  tabId: string,
): FirestoreQueryRuntimeState {
  return { ...state, pendingPageReloads: omitKey(state.pendingPageReloads, tabId) };
}

export function firestoreQueryCompletionRecorded(
  state: FirestoreQueryRuntimeState,
  key: string,
): FirestoreQueryRuntimeState {
  if (state.recordedQueryCompletions[key]) return state;
  return {
    ...state,
    recordedQueryCompletions: pruneRecordedQueryCompletions({
      ...state.recordedQueryCompletions,
      [key]: true,
    }),
  };
}

export function firestoreTabCleared(
  state: FirestoreQueryRuntimeState,
  tabId: string,
): FirestoreQueryRuntimeState {
  return {
    ...state,
    pendingPageReloads: omitKey(state.pendingPageReloads, tabId),
    queryRequests: omitKey(state.queryRequests, tabId),
    recordedQueryCompletions: omitRecordedQueryCompletionsForTab(
      state.recordedQueryCompletions,
      tabId,
    ),
    resultsByTab: omitKey(state.resultsByTab, tabId),
    selectedDocumentPaths: omitKey(state.selectedDocumentPaths, tabId),
  };
}

export function firestoreQueryRequestFor(
  state: FirestoreQueryRuntimeState,
  tabId: string,
): SubmittedFirestoreQuery | null {
  return state.queryRequests[tabId] ?? null;
}

function omitKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function omitRecordedQueryCompletionsForTab(
  record: Readonly<Record<string, true>>,
  tabId: string,
): Readonly<Record<string, true>> {
  const prefix = `${tabId}:`;
  let changed = false;
  const next: Record<string, true> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith(prefix)) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : record;
}

function pruneRecordedQueryCompletions(
  record: Readonly<Record<string, true>>,
): Readonly<Record<string, true>> {
  const entries = Object.entries(record);
  if (entries.length <= 500) return record;
  return Object.fromEntries(entries.slice(entries.length - 500)) as Record<string, true>;
}

function updateTabResult(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  update: (current: FirestoreQueryResultState) => FirestoreQueryResultState,
): FirestoreQueryRuntimeState {
  const nextResult = update(state.resultsByTab[tabId] ?? emptyFirestoreQueryResultState());
  return {
    ...state,
    resultsByTab: { ...state.resultsByTab, [tabId]: nextResult },
  };
}

function updateTabInspectorUi(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  update: (current: FirestoreInspectorUiState) => FirestoreInspectorUiState,
): FirestoreQueryRuntimeState {
  return {
    ...state,
    inspectorUiByTab: {
      ...state.inspectorUiByTab,
      [tabId]: update(state.inspectorUiByTab[tabId] ?? defaultFirestoreInspectorUiState()),
    },
  };
}

function emptyFirestoreQueryResultStateWithView(
  resultView: FirestoreQueryResultState['resultView'],
): FirestoreQueryResultState {
  return { ...emptyFirestoreQueryResultState(), resultView };
}

function updateAllTabResults(
  state: FirestoreQueryRuntimeState,
  update: (current: FirestoreQueryResultState) => FirestoreQueryResultState,
): FirestoreQueryRuntimeState {
  return {
    ...state,
    resultsByTab: Object.fromEntries(
      Object.entries(state.resultsByTab).map(([tabId, result]) => [tabId, update(result)]),
    ),
  };
}
