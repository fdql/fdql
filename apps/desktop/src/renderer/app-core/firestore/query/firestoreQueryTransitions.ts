import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import type {
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreQuery,
} from '@firebase-desk/repo-contracts';
import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import { firestoreDraftFingerprint, normalizeFirestorePath } from './firestoreQueryDraft.ts';
import type {
  FirestoreQueryPage,
  FirestoreQueryResultState,
  FirestoreQueryRuntimeState,
  SubmittedFirestoreQuery,
  SubmittedFirestoreSubcollectionLoad,
} from './firestoreQueryState.ts';
import { emptyFirestoreQueryResultState } from './firestoreQueryState.ts';

export function firestoreQueryStarted(
  state: FirestoreQueryRuntimeState,
  input: {
    readonly clearSelection: boolean;
    readonly draft: FirestoreQueryDraft;
    readonly limit: number;
    readonly query: FirestoreQuery;
    readonly tabId: string;
  },
): FirestoreQueryRuntimeState {
  const requestId = state.nextRequestId;
  const epoch = state.tabEpochs[input.tabId] ?? 0;
  const execution = submittedFirestoreQuery({
    draft: input.draft,
    epoch,
    limit: input.limit,
    query: input.query,
    requestId,
    tabId: input.tabId,
  });
  return updateTabResult(
    {
      ...state,
      nextRequestId: requestId + 1,
      pendingPageReloads: omitKey(state.pendingPageReloads, input.tabId),
      queryRequests: {
        ...state.queryRequests,
        [input.tabId]: execution,
      },
      selectedDocumentPaths: input.clearSelection
        ? omitKey(state.selectedDocumentPaths, input.tabId)
        : state.selectedDocumentPaths,
      subcollectionRequests: omitSubcollectionRequestsForTab(
        state.subcollectionRequests,
        input.tabId,
      ),
    },
    input.tabId,
    () => ({
      errorMessage: null,
      execution,
      hasMore: false,
      isFetchingMore: false,
      pages: [],
      resultsStale: false,
      status: 'loading',
    }),
  );
}

export function firestoreQuerySucceeded(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  pages: ReadonlyArray<FirestoreQueryPage>,
  hasMore = false,
  execution: SubmittedFirestoreQuery,
): FirestoreQueryRuntimeState {
  if (!isCurrentTabExecution(state, tabId, execution)) return state;
  const resultsStale = matchingResultExecution(state, execution)?.resultsStale ?? false;
  return updateTabResult(state, tabId, () => ({
    errorMessage: null,
    execution,
    hasMore,
    isFetchingMore: false,
    pages,
    resultsStale,
    status: 'success',
  }));
}

export function firestoreQueryFailed(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  message: string,
  execution: SubmittedFirestoreQuery,
): FirestoreQueryRuntimeState {
  if (!isCurrentTabExecution(state, tabId, execution)) return state;
  const resultsStale = matchingResultExecution(state, execution)?.resultsStale ?? false;
  return updateTabResult(state, tabId, () => ({
    errorMessage: message,
    execution,
    hasMore: false,
    isFetchingMore: false,
    pages: [],
    resultsStale,
    status: 'error',
  }));
}

export function firestoreLoadMoreStarted(
  state: FirestoreQueryRuntimeState,
  tabId: string,
): FirestoreQueryRuntimeState {
  const execution = state.queryRequests[tabId];
  const result = state.resultsByTab[tabId];
  if (
    !execution || !result || result.status === 'idle' || result.status === 'loading'
    || result.execution.token !== execution.token || result.isFetchingMore || !result.hasMore
    || !result.pages[result.pages.length - 1]?.nextCursor
  ) {
    return state;
  }
  return updateTabResult(state, tabId, () => ({
    ...result,
    errorMessage: null,
    isFetchingMore: true,
    status: 'success',
  }));
}

export function firestoreLoadMoreSucceeded(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  page: FirestoreQueryPage,
  hasMore = false,
  execution: SubmittedFirestoreQuery,
): FirestoreQueryRuntimeState {
  if (!isCurrentTabResultExecution(state, tabId, execution)) return state;
  const current = state.resultsByTab[tabId]!;
  return updateTabResult(state, tabId, () => ({
    ...current,
    errorMessage: null,
    execution,
    hasMore,
    isFetchingMore: false,
    pages: [...current.pages, page],
    status: 'success',
  }));
}

export function firestoreLoadMoreFailed(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  message: string,
  execution: SubmittedFirestoreQuery,
): FirestoreQueryRuntimeState {
  if (!isCurrentTabResultExecution(state, tabId, execution)) return state;
  const current = state.resultsByTab[tabId]!;
  return updateTabResult(state, tabId, () => ({
    ...current,
    errorMessage: message,
    execution,
    isFetchingMore: false,
    status: 'error',
  }));
}

export function firestoreRefreshStarted(
  state: FirestoreQueryRuntimeState,
  input: {
    readonly limit: number;
    readonly draft: FirestoreQueryDraft;
    readonly pagesToReload: number;
    readonly query: FirestoreQuery;
    readonly tabId: string;
  },
): FirestoreQueryRuntimeState {
  const started = firestoreQueryStarted(state, {
    clearSelection: false,
    draft: input.draft,
    limit: input.limit,
    query: input.query,
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
  execution: SubmittedFirestoreQuery,
): FirestoreQueryRuntimeState {
  if (!isCurrentTabExecution(state, tabId, execution)) return state;
  return {
    ...firestoreQuerySucceeded(state, tabId, pages, hasMore, execution),
    pendingPageReloads: omitKey(state.pendingPageReloads, tabId),
  };
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

export function firestoreSubcollectionsLoadStarted(
  state: FirestoreQueryRuntimeState,
  request: SubmittedFirestoreSubcollectionLoad,
): FirestoreQueryRuntimeState {
  const { tabId } = request.execution.token;
  const result = state.resultsByTab[tabId];
  if (
    request.token.documentPath !== request.documentPath
    || request.token.queryToken !== request.execution.token
    || !isCurrentResultExecution(state, request.execution)
    || !result
    || !pagesContainDocument(result.pages, request.documentPath)
  ) return state;
  return {
    ...state,
    subcollectionRequests: {
      ...state.subcollectionRequests,
      [subcollectionRequestKey(tabId, request.documentPath)]: request,
    },
  };
}

export function firestoreSubcollectionsLoaded(
  state: FirestoreQueryRuntimeState,
  input: {
    readonly request: SubmittedFirestoreSubcollectionLoad;
    readonly subcollections: ReadonlyArray<FirestoreCollectionNode>;
  },
): FirestoreQueryRuntimeState {
  const { request } = input;
  const { tabId } = request.execution.token;
  const key = subcollectionRequestKey(tabId, request.documentPath);
  if (
    !isCurrentResultExecution(state, request.execution)
    || state.subcollectionRequests[key]?.token !== request.token
  ) return state;
  const updated = updateTabResult(state, tabId, (current) => ({
    ...current,
    pages: mergeSubcollectionsIntoPages(
      current.pages,
      request.documentPath,
      input.subcollections,
    ),
  }));
  return {
    ...updated,
    subcollectionRequests: omitKey(updated.subcollectionRequests, key),
  };
}

export function firestoreSubcollectionsLoadFailed(
  state: FirestoreQueryRuntimeState,
  request: SubmittedFirestoreSubcollectionLoad,
): FirestoreQueryRuntimeState {
  const key = subcollectionRequestKey(request.execution.token.tabId, request.documentPath);
  if (state.subcollectionRequests[key]?.token !== request.token) return state;
  return {
    ...state,
    subcollectionRequests: omitKey(state.subcollectionRequests, key),
  };
}

export function firestoreResultDocumentSaved(
  state: FirestoreQueryRuntimeState,
  execution: SubmittedFirestoreQuery,
  document: FirestoreDocumentResult,
): FirestoreQueryRuntimeState {
  const disposition = firestoreWriteResultDisposition(state, execution);
  if (disposition === 'ignore') return state;
  if (disposition === 'mark-stale') {
    return firestoreResultsMarkedStale(state, execution.token.tabId);
  }
  return updateTabResult(state, execution.token.tabId, (current) => ({
    ...current,
    pages: replaceDocumentInPages(current.pages, document),
    resultsStale: true,
  }));
}

export function firestoreResultDocumentDeleted(
  state: FirestoreQueryRuntimeState,
  execution: SubmittedFirestoreQuery,
  documentPath: string,
): FirestoreQueryRuntimeState {
  const disposition = firestoreWriteResultDisposition(state, execution);
  if (disposition === 'ignore') return state;
  if (disposition === 'mark-stale') {
    return firestoreResultsMarkedStale(state, execution.token.tabId);
  }
  const { tabId } = execution.token;
  return {
    ...updateTabResult(state, tabId, (current) => ({
      ...current,
      pages: removeDocumentFromPages(current.pages, documentPath),
      resultsStale: true,
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
    items: mergeSubcollectionsIntoRows(page.items, documentPath, subcollections),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  }));
}

function mergeSubcollectionsIntoRows(
  documents: ReadonlyArray<FirestoreDocumentResult>,
  documentPath: string,
  subcollections: ReadonlyArray<FirestoreCollectionNode>,
): ReadonlyArray<FirestoreDocumentResult> {
  return documents.map((document) => {
    if (document.path === documentPath) return { ...document, subcollections };
    const nested = document.subcollections?.map((collection) => {
      const collectionDocuments = documentsForCollection(collection);
      return collectionDocuments
        ? withCollectionDocuments(
          collection,
          mergeSubcollectionsIntoRows(collectionDocuments, documentPath, subcollections),
        )
        : collection;
    });
    return nested ? { ...document, subcollections: nested } : document;
  });
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

function mutatedCollectionTargets(
  job: BackgroundJob,
): ReadonlyArray<{ readonly connectionId: string; readonly path: string; }> {
  if (job.status !== 'succeeded') return [];
  const request = job.request;
  if (request.type === 'firestore.exportCollection') return [];
  if (request.type === 'firestore.copyCollection') {
    return [{
      connectionId: request.targetConnectionId,
      path: normalizeFirestorePath(request.targetCollectionPath),
    }];
  }
  if (request.type === 'firestore.importCollection') {
    return [{
      connectionId: request.connectionId,
      path: normalizeFirestorePath(request.targetCollectionPath),
    }];
  }
  if (request.type === 'firestore.duplicateCollection') {
    return [{
      connectionId: request.connectionId,
      path: normalizeFirestorePath(request.targetCollectionPath),
    }];
  }
  return [{
    connectionId: request.connectionId,
    path: normalizeFirestorePath(request.collectionPath),
  }];
}

function firestorePathsOverlap(leftPath: string, rightPath: string): boolean {
  const left = normalizeFirestorePath(leftPath);
  const right = normalizeFirestorePath(rightPath);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
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

export function firestoreCollectionJobSucceeded(
  state: FirestoreQueryRuntimeState,
  job: BackgroundJob,
): FirestoreQueryRuntimeState {
  const targets = mutatedCollectionTargets(job);
  if (!targets.length) return state;
  let changed = false;
  const resultsByTab = Object.fromEntries(
    Object.entries(state.resultsByTab).map(([tabId, result]) => {
      const execution = result.execution;
      if (
        !execution
        || result.resultsStale
        || !isCurrentResultExecution(state, execution)
        || !targets.some((target) =>
          target.connectionId === execution.query.connectionId
          && firestorePathsOverlap(target.path, execution.query.path)
        )
      ) return [tabId, result];
      changed = true;
      return [tabId, { ...result, resultsStale: true }];
    }),
  );
  return changed ? { ...state, resultsByTab } : state;
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

export function firestoreTabRuntimeInvalidated(
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
    resultsByTab: state.resultsByTab[tabId]
      ? {
        ...state.resultsByTab,
        [tabId]: emptyFirestoreQueryResultState(),
      }
      : state.resultsByTab,
    selectedDocumentPaths: omitKey(state.selectedDocumentPaths, tabId),
    subcollectionRequests: omitSubcollectionRequestsForTab(
      state.subcollectionRequests,
      tabId,
    ),
    tabEpochs: {
      ...state.tabEpochs,
      [tabId]: (state.tabEpochs[tabId] ?? 0) + 1,
    },
  };
}

export function firestoreTabCleared(
  state: FirestoreQueryRuntimeState,
  tabId: string,
): FirestoreQueryRuntimeState {
  const invalidated = firestoreTabRuntimeInvalidated(state, tabId);
  return {
    ...invalidated,
    resultsByTab: omitKey(invalidated.resultsByTab, tabId),
  };
}

export function firestoreQueryRequestFor(
  state: FirestoreQueryRuntimeState,
  tabId: string,
): SubmittedFirestoreQuery | null {
  return state.queryRequests[tabId] ?? null;
}

function submittedFirestoreQuery(
  input: {
    readonly draft: FirestoreQueryDraft;
    readonly epoch: number;
    readonly limit: number;
    readonly query: FirestoreQuery;
    readonly requestId: number;
    readonly tabId: string;
  },
): SubmittedFirestoreQuery {
  const query = snapshotQuery(input.query);
  const token = Object.freeze({
    connectionId: query.connectionId,
    epoch: input.epoch,
    path: query.path,
    requestId: input.requestId,
    tabId: input.tabId,
  });
  return Object.freeze({
    draft: snapshotDraft(input.draft),
    limit: input.limit,
    query,
    requestId: input.requestId,
    runId: input.requestId,
    token,
  });
}

function snapshotDraft(draft: FirestoreQueryDraft): FirestoreQueryDraft {
  return Object.freeze({
    ...draft,
    ...(draft.filters
      ? { filters: Object.freeze(draft.filters.map((filter) => Object.freeze({ ...filter }))) }
      : {}),
  });
}

function snapshotQuery(query: FirestoreQuery): FirestoreQuery {
  return Object.freeze({
    ...query,
    ...(query.filters
      ? {
        filters: Object.freeze(
          query.filters.map((filter) =>
            Object.freeze({ ...filter, value: snapshotQueryValue(filter.value) })
          ),
        ),
      }
      : {}),
    ...(query.sorts
      ? { sorts: Object.freeze(query.sorts.map((sort) => Object.freeze({ ...sort }))) }
      : {}),
  });
}

function snapshotQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshotQueryValue));
  if (!isPlainRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, snapshotQueryValue(nested)]),
    ),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function matchingResultExecution(
  state: FirestoreQueryRuntimeState,
  execution: SubmittedFirestoreQuery,
): FirestoreQueryResultState | null {
  const result = state.resultsByTab[execution.token.tabId];
  return result?.execution?.token === execution.token ? result : null;
}

function firestoreWriteResultDisposition(
  state: FirestoreQueryRuntimeState,
  execution: SubmittedFirestoreQuery,
): 'apply' | 'ignore' | 'mark-stale' {
  if (isCurrentResultExecution(state, execution)) {
    return state.resultsByTab[execution.token.tabId]?.status === 'success'
      ? 'apply'
      : 'mark-stale';
  }
  const current = state.resultsByTab[execution.token.tabId]?.execution;
  if (!current || !isCurrentResultExecution(state, current)) return 'ignore';
  return firestoreDraftFingerprint(current.query.connectionId, current.draft)
      === firestoreDraftFingerprint(execution.query.connectionId, execution.draft)
    ? 'mark-stale'
    : 'ignore';
}

function isCurrentExecution(
  state: FirestoreQueryRuntimeState,
  execution: SubmittedFirestoreQuery,
): boolean {
  const { token } = execution;
  return token.connectionId === execution.query.connectionId
    && token.epoch === (state.tabEpochs[token.tabId] ?? 0)
    && token.path === execution.query.path
    && token.requestId === execution.requestId
    && execution.runId === execution.requestId
    && state.queryRequests[token.tabId]?.token === token;
}

function isCurrentResultExecution(
  state: FirestoreQueryRuntimeState,
  execution: SubmittedFirestoreQuery,
): boolean {
  return isCurrentExecution(state, execution)
    && state.resultsByTab[execution.token.tabId]?.execution?.token === execution.token;
}

function isCurrentTabExecution(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  execution: SubmittedFirestoreQuery,
): boolean {
  return execution.token.tabId === tabId && isCurrentExecution(state, execution);
}

function isCurrentTabResultExecution(
  state: FirestoreQueryRuntimeState,
  tabId: string,
  execution: SubmittedFirestoreQuery,
): boolean {
  return execution.token.tabId === tabId && isCurrentResultExecution(state, execution);
}

function pagesContainDocument(
  pages: ReadonlyArray<FirestoreQueryPage>,
  documentPath: string,
): boolean {
  return pages.some((page) => documentsContainPath(page.items, documentPath));
}

function documentsContainPath(
  documents: ReadonlyArray<FirestoreDocumentResult>,
  documentPath: string,
): boolean {
  return documents.some((document) => {
    if (document.path === documentPath) return true;
    return document.subcollections?.some((collection) => {
      const nested = documentsForCollection(collection);
      return nested ? documentsContainPath(nested, documentPath) : false;
    }) ?? false;
  });
}

function subcollectionRequestKey(tabId: string, documentPath: string): string {
  return `${tabId}\u0000${documentPath}`;
}

function omitSubcollectionRequestsForTab(
  record: FirestoreQueryRuntimeState['subcollectionRequests'],
  tabId: string,
): FirestoreQueryRuntimeState['subcollectionRequests'] {
  const prefix = `${tabId}\u0000`;
  let changed = false;
  const next: Record<string, SubmittedFirestoreSubcollectionLoad> = {};
  for (const [key, request] of Object.entries(record)) {
    if (key.startsWith(prefix)) {
      changed = true;
      continue;
    }
    next[key] = request;
  }
  return changed ? next : record;
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
