import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import type { FirestoreCollectionNode, FirestoreQuery } from '@firebase-desk/repo-contracts';
import type {
  FirestoreQueryPage,
  FirestoreQueryResultState,
  FirestoreQueryRuntimeState,
  FirestoreResultView,
  SubmittedFirestoreQuery,
} from './firestoreQueryState.ts';
import { emptyFirestoreQueryResultState } from './firestoreQueryState.ts';

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
