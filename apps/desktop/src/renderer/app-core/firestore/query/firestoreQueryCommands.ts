import type {
  ActivityLogAppendInput,
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreQuery,
  FirestoreQueryDraft,
  Page,
  PageRequest,
} from '@firebase-desk/repo-contracts';
import {
  type AppCoreCommandOptions,
  commandActivityMetadata,
  normalizeCommandOptions,
} from '../../shared/commandOptions.ts';
import { messageFromError } from '../../shared/errors.ts';
import type { AppCoreStore } from '../../shared/store.ts';
import { elapsedMs } from '../../shared/time.ts';
import {
  firestoreQueryDraftMetadata,
  firestoreQueryMetadata,
  isCurrentFirestoreQueryExecution,
  selectFirestoreLoadedPageCount,
  selectFirestoreResultRows,
  selectFirestoreTabResultState,
} from './firestoreQuerySelectors.ts';
import type {
  FirestoreQueryPage,
  FirestoreQueryRuntimeState,
  SubmittedFirestoreQuery,
  SubmittedFirestoreSubcollectionLoad,
} from './firestoreQueryState.ts';
import {
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
  firestoreSubcollectionsLoaded,
  firestoreSubcollectionsLoadFailed,
  firestoreSubcollectionsLoadStarted,
} from './firestoreQueryTransitions.ts';

interface FirestoreQueryTabLike {
  readonly id: string;
  readonly kind: string;
}

interface FirestoreQueryExecutionTabLike extends FirestoreQueryTabLike {
  readonly connectionId: string;
}

export interface FirestoreQueryExecutionEnvironment {
  readonly getDocument: (
    connectionId: string,
    path: string,
  ) => Promise<FirestoreDocumentResult | null>;
  readonly now: () => number;
  readonly recordActivity?: ((input: ActivityLogAppendInput) => Promise<void> | void) | undefined;
  readonly runQuery: (
    query: FirestoreQuery,
    request: PageRequest,
  ) => Promise<Page<FirestoreDocumentResult>>;
}

export interface FirestoreQuerySubmitCommandInput {
  readonly activeDraft: FirestoreQueryDraft;
  readonly clearSelection: boolean;
  readonly commandOptions?: AppCoreCommandOptions | undefined;
  readonly query: FirestoreQuery;
  readonly selectedTreeItemId: string | null;
  readonly tab: FirestoreQueryTabLike | undefined;
}

export interface FirestoreQuerySubmitCommandResult {
  readonly interaction: {
    readonly activeTabId: string;
    readonly path: string;
    readonly selectedTreeItemId: string | null;
  } | null;
  readonly path: string | null;
  readonly state: FirestoreQueryRuntimeState;
}

export interface FirestoreQueryCompletionInput {
  readonly commandOptions?: AppCoreCommandOptions | undefined;
  readonly connectionId: string;
  readonly draft: FirestoreQueryDraft;
  readonly durationMs?: number | undefined;
  readonly errorMessage: string | null;
  readonly loadedPages: number;
  readonly resultCount: number;
}

export interface FirestoreQueryCompletionCommandInput extends FirestoreQueryCompletionInput {
  readonly isDocumentQuery: boolean;
  readonly isLoading: boolean;
  readonly pendingPageReloadCount: number;
  readonly runId: number | null;
  readonly tabId: string | null;
}

export interface FirestoreQueryCompletionCommandResult {
  readonly activity: ActivityLogAppendInput | null;
  readonly state: FirestoreQueryRuntimeState;
}

export interface FirestorePageReloadCommandInput {
  readonly hasNextPage: boolean;
  readonly isDocumentQuery: boolean;
  readonly isFetchingNextPage: boolean;
  readonly loadedPageCount: number;
  readonly pendingPageReloadCount: number;
  readonly tabId: string | null;
}

export interface FirestoreLoadMoreCommandResult {
  readonly shouldFetchNextPage: boolean;
  readonly state: FirestoreQueryRuntimeState;
}

export interface FirestoreOpenDocumentIntent {
  readonly connectionId: string;
  readonly path: string;
}

export function runFirestoreQueryCommand(
  state: FirestoreQueryRuntimeState,
  input: FirestoreQuerySubmitCommandInput,
): FirestoreQuerySubmitCommandResult {
  const target = queryCommandTarget(input);
  if (!target) {
    return { interaction: null, path: null, state };
  }
  return {
    interaction: target.visible
      ? {
        activeTabId: target.tabId,
        path: input.activeDraft.path,
        selectedTreeItemId: input.selectedTreeItemId,
      }
      : null,
    path: input.activeDraft.path,
    state: firestoreQueryStarted(state, {
      clearSelection: input.clearSelection,
      draft: input.activeDraft,
      limit: input.activeDraft.limit,
      query: input.query,
      tabId: target.tabId,
    }),
  };
}

export function loadMoreFirestoreQueryCommand(
  state: FirestoreQueryRuntimeState,
  input: { readonly isDocumentQuery: boolean; readonly tabId: string | null; },
): FirestoreLoadMoreCommandResult {
  if (input.isDocumentQuery || !input.tabId) return { shouldFetchNextPage: false, state };
  const next = firestoreLoadMoreStarted(state, input.tabId);
  return { shouldFetchNextPage: next !== state, state: next };
}

export async function executeFirestoreQueryCommand(
  store: AppCoreStore<FirestoreQueryRuntimeState>,
  env: FirestoreQueryExecutionEnvironment,
  input: {
    readonly commandOptions?: AppCoreCommandOptions | undefined;
    readonly draft: FirestoreQueryDraft;
    readonly isRefresh: boolean;
    readonly pagesToLoad: number;
    readonly request: NonNullable<FirestoreQueryRuntimeState['queryRequests'][string]>;
    readonly tab: FirestoreQueryExecutionTabLike;
  },
): Promise<void> {
  const { query, limit } = input.request;
  const isDocumentQuery = isFirestoreDocumentPath(query.path);
  const startedAt = env.now();
  try {
    const pages = isDocumentQuery
      ? await loadDocumentPage(env, query.connectionId, query.path)
      : await loadQueryPages(env, query, limit, input.pagesToLoad);
    const hasMore = !isDocumentQuery && Boolean(pages[pages.length - 1]?.nextCursor);
    const transition = (current: FirestoreQueryRuntimeState) =>
      input.isRefresh
        ? firestoreRefreshSucceeded(
          current,
          input.request.token.tabId,
          pages,
          hasMore,
          input.request,
        )
        : firestoreQuerySucceeded(
          current,
          input.request.token.tabId,
          pages,
          hasMore,
          input.request,
        );
    completeExecutedFirestoreQuery(store, env, {
      commandOptions: input.commandOptions,
      durationMs: elapsedMs(startedAt, env.now()),
      errorMessage: null,
      execution: input.request,
      isDocumentQuery,
      loadedPages: selectFirestoreLoadedPageCount(pages, isDocumentQuery, pages.length > 0),
      resultCount: selectFirestoreResultRows(pages).length,
      transition,
    });
  } catch (error) {
    const loadErrorMessage = messageFromError(error, 'Could not load Firestore data.');
    completeExecutedFirestoreQuery(store, env, {
      commandOptions: input.commandOptions,
      durationMs: elapsedMs(startedAt, env.now()),
      errorMessage: loadErrorMessage,
      execution: input.request,
      isDocumentQuery,
      loadedPages: 0,
      resultCount: 0,
      transition: (current) =>
        firestoreQueryFailed(
          current,
          input.request.token.tabId,
          loadErrorMessage,
          input.request,
        ),
    });
  }
}

export async function executeFirestoreLoadMoreCommand(
  store: AppCoreStore<FirestoreQueryRuntimeState>,
  env: FirestoreQueryExecutionEnvironment,
  input: {
    readonly commandOptions?: AppCoreCommandOptions | undefined;
    readonly request: NonNullable<FirestoreQueryRuntimeState['queryRequests'][string]>;
    readonly tab: FirestoreQueryExecutionTabLike;
  },
): Promise<void> {
  const stateSnapshot = store.get();
  if (!isCurrentFirestoreQueryExecution(stateSnapshot, input.request)) return;
  const tabId = input.request.token.tabId;
  const tabResult = selectFirestoreTabResultState(stateSnapshot, {
    id: tabId,
    kind: 'firestore-query',
  });
  if (tabResult.execution?.token !== input.request.token) return;
  const cursor = tabResult.pages[tabResult.pages.length - 1]?.nextCursor;
  if (!cursor) {
    store.update((state) =>
      firestoreLoadMoreSucceeded(state, tabId, { items: [] }, false, input.request)
    );
    return;
  }
  const startedAt = env.now();
  try {
    const page = await env.runQuery(input.request.query, pageRequest(cursor, input.request.limit));
    let currentRun = false;
    store.update((state) => {
      if (!isCurrentFirestoreQueryExecution(state, input.request)) return state;
      currentRun = true;
      return firestoreLoadMoreSucceeded(
        state,
        tabId,
        firestoreQueryPage(page.items, page.nextCursor),
        Boolean(page.nextCursor),
        input.request,
      );
    });
    if (currentRun) {
      void env.recordActivity?.(firestoreLoadMoreActivity({
        commandOptions: input.commandOptions,
        durationMs: elapsedMs(startedAt, env.now()),
        errorMessage: null,
        hasMore: Boolean(page.nextCursor),
        request: input.request,
        resultCount: page.items.length,
      }));
    }
  } catch (error) {
    const moreErrorMessage = messageFromError(error, 'Could not load Firestore data.');
    let currentRun = false;
    store.update((state) => {
      if (!isCurrentFirestoreQueryExecution(state, input.request)) return state;
      currentRun = true;
      return firestoreLoadMoreFailed(state, tabId, moreErrorMessage, input.request);
    });
    if (currentRun) {
      void env.recordActivity?.(firestoreLoadMoreActivity({
        commandOptions: input.commandOptions,
        durationMs: elapsedMs(startedAt, env.now()),
        errorMessage: moreErrorMessage,
        hasMore: false,
        request: input.request,
        resultCount: 0,
      }));
    }
  }
}

export function continueFirestorePageReloadCommand(
  state: FirestoreQueryRuntimeState,
  input: FirestorePageReloadCommandInput,
): FirestoreLoadMoreCommandResult {
  if (
    !input.tabId || input.isDocumentQuery || input.pendingPageReloadCount === 0
    || input.loadedPageCount === 0
  ) {
    return { shouldFetchNextPage: false, state };
  }
  if (
    input.pendingPageReloadCount <= 1 || input.loadedPageCount >= input.pendingPageReloadCount
    || !input.hasNextPage
  ) {
    return {
      shouldFetchNextPage: false,
      state: firestorePendingPageReloadCleared(state, input.tabId),
    };
  }
  if (input.isFetchingNextPage) return { shouldFetchNextPage: false, state };
  return { shouldFetchNextPage: true, state };
}

export interface FirestoreSubcollectionsLoadStartResult {
  readonly request: SubmittedFirestoreSubcollectionLoad | null;
  readonly state: FirestoreQueryRuntimeState;
}

export function startFirestoreSubcollectionsLoadCommand(
  state: FirestoreQueryRuntimeState,
  input: {
    readonly documentPath: string;
    readonly execution: SubmittedFirestoreQuery;
  },
): FirestoreSubcollectionsLoadStartResult {
  const token = Object.freeze({
    documentPath: input.documentPath,
    queryToken: input.execution.token,
  });
  const request = Object.freeze({
    documentPath: input.documentPath,
    execution: input.execution,
    token,
  });
  const next = firestoreSubcollectionsLoadStarted(state, request);
  return next === state ? { request: null, state } : { request, state: next };
}

export function completeFirestoreSubcollectionsLoadCommand(
  state: FirestoreQueryRuntimeState,
  input: {
    readonly request: SubmittedFirestoreSubcollectionLoad;
    readonly subcollections: ReadonlyArray<FirestoreCollectionNode>;
  },
): FirestoreQueryRuntimeState {
  return firestoreSubcollectionsLoaded(state, input);
}

export function failFirestoreSubcollectionsLoadCommand(
  state: FirestoreQueryRuntimeState,
  request: SubmittedFirestoreSubcollectionLoad,
): FirestoreQueryRuntimeState {
  return firestoreSubcollectionsLoadFailed(state, request);
}

export function openFirestoreDocumentInNewTabCommand(
  connectionId: string,
  path: string,
): FirestoreOpenDocumentIntent {
  return { connectionId, path };
}

export function completeFirestoreQueryCommand(
  state: FirestoreQueryRuntimeState,
  input: FirestoreQueryCompletionCommandInput,
): FirestoreQueryCompletionCommandResult {
  if (!input.tabId || input.runId === null || input.isLoading) {
    return { activity: null, state };
  }
  if (!input.isDocumentQuery && input.pendingPageReloadCount > 0) {
    return { activity: null, state };
  }
  const key = `${input.tabId}:${input.runId}`;
  if (state.recordedQueryCompletions[key]) return { activity: null, state };
  return {
    activity: firestoreQueryCompletionActivity(input),
    state: firestoreQueryCompletionRecorded(state, key),
  };
}

function completeExecutedFirestoreQuery(
  store: AppCoreStore<FirestoreQueryRuntimeState>,
  env: FirestoreQueryExecutionEnvironment,
  input: {
    readonly commandOptions?: AppCoreCommandOptions | undefined;
    readonly durationMs?: number | undefined;
    readonly errorMessage: string | null;
    readonly execution: NonNullable<FirestoreQueryRuntimeState['queryRequests'][string]>;
    readonly isDocumentQuery: boolean;
    readonly loadedPages: number;
    readonly resultCount: number;
    readonly transition: (state: FirestoreQueryRuntimeState) => FirestoreQueryRuntimeState;
  },
): void {
  const current = store.get();
  if (!isCurrentFirestoreQueryExecution(current, input.execution)) return;
  const transitioned = input.transition(current);
  const result = completeFirestoreQueryCommand(transitioned, {
    commandOptions: input.commandOptions,
    connectionId: input.execution.query.connectionId,
    draft: input.execution.draft,
    durationMs: input.durationMs,
    errorMessage: input.errorMessage,
    isDocumentQuery: input.isDocumentQuery,
    isLoading: false,
    loadedPages: input.loadedPages,
    pendingPageReloadCount: 0,
    resultCount: input.resultCount,
    runId: input.execution.runId,
    tabId: input.execution.token.tabId,
  });
  store.set(result.state);
  if (result.activity) void env.recordActivity?.(result.activity);
}

async function loadDocumentPage(
  env: FirestoreQueryExecutionEnvironment,
  connectionId: string,
  path: string,
): Promise<ReadonlyArray<FirestoreQueryPage>> {
  const document = await env.getDocument(connectionId, path);
  return document ? [{ items: [document] }] : [];
}

async function loadQueryPages(
  env: FirestoreQueryExecutionEnvironment,
  query: FirestoreQuery,
  limit: number,
  pagesToLoad: number,
): Promise<ReadonlyArray<FirestoreQueryPage>> {
  const pages: FirestoreQueryPage[] = [];
  let cursor: PageRequest['cursor'] | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop -- Each page depends on the previous cursor.
    const page = await env.runQuery(query, pageRequest(cursor, limit));
    pages.push(firestoreQueryPage(page.items, page.nextCursor));
    cursor = page.nextCursor ?? undefined;
  } while (cursor && pages.length < pagesToLoad);
  return pages;
}

function pageRequest(cursor: PageRequest['cursor'] | undefined, limit: number): PageRequest {
  return cursor ? { cursor, limit } : { limit };
}

function firestoreQueryPage(
  items: ReadonlyArray<FirestoreDocumentResult>,
  nextCursor: PageRequest['cursor'] | null | undefined,
): FirestoreQueryPage {
  return nextCursor ? { items, nextCursor } : { items };
}

function firestoreLoadMoreActivity(
  input: {
    readonly commandOptions?: AppCoreCommandOptions | undefined;
    readonly durationMs?: number | undefined;
    readonly errorMessage: string | null;
    readonly hasMore: boolean;
    readonly request: NonNullable<FirestoreQueryRuntimeState['queryRequests'][string]>;
    readonly resultCount: number;
  },
): ActivityLogAppendInput {
  return {
    action: 'Load more results',
    area: 'firestore',
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.errorMessage ? { error: { message: input.errorMessage } } : {}),
    metadata: {
      hasMore: input.hasMore,
      resultCount: input.resultCount,
      ...commandActivityMetadata(input.commandOptions),
      ...firestoreQueryMetadata(input.request.query, input.request.limit),
    },
    status: input.errorMessage ? 'failure' : 'success',
    summary: input.errorMessage
      ? input.errorMessage
      : `Loaded ${input.resultCount} more result${
        input.resultCount === 1 ? '' : 's'
      } from ${input.request.query.path}`,
    target: {
      connectionId: input.request.query.connectionId,
      path: input.request.query.path,
      type: 'firestore-query',
    },
  };
}

export function firestoreQueryCompletionActivity(
  input: FirestoreQueryCompletionInput,
): ActivityLogAppendInput {
  const isDocument = isFirestoreDocumentPath(input.draft.path);
  return {
    action: isDocument ? 'Read document' : 'Run query',
    area: 'firestore',
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.errorMessage ? { error: { message: input.errorMessage } } : {}),
    metadata: {
      isDocument,
      loadedPages: input.loadedPages,
      resultCount: input.resultCount,
      ...commandActivityMetadata(input.commandOptions),
      ...firestoreQueryDraftMetadata(input.draft),
    },
    status: input.errorMessage ? 'failure' : 'success',
    summary: input.errorMessage
      ? `Failed to load ${input.draft.path}`
      : `Loaded ${input.resultCount} result${
        input.resultCount === 1 ? '' : 's'
      } from ${input.draft.path}`,
    target: {
      connectionId: input.connectionId,
      path: input.draft.path,
      type: isDocument ? 'firestore-document' : 'firestore-query',
    },
  };
}

function isFirestoreDocumentPath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 && parts.length % 2 === 0;
}

export function refreshFirestoreQueryCommand(
  state: FirestoreQueryRuntimeState,
  input: FirestoreQuerySubmitCommandInput & { readonly pagesToReload: number; },
): FirestoreQuerySubmitCommandResult {
  const target = queryCommandTarget(input);
  if (!target) {
    return { interaction: null, path: null, state };
  }
  return {
    interaction: target.visible
      ? {
        activeTabId: target.tabId,
        path: input.activeDraft.path,
        selectedTreeItemId: input.selectedTreeItemId,
      }
      : null,
    path: input.activeDraft.path,
    state: firestoreRefreshStarted(state, {
      draft: input.activeDraft,
      limit: input.activeDraft.limit,
      pagesToReload: input.pagesToReload,
      query: input.query,
      tabId: target.tabId,
    }),
  };
}

function queryCommandTarget(
  input: FirestoreQuerySubmitCommandInput,
): { readonly tabId: string; readonly visible: boolean; } | null {
  const options = normalizeCommandOptions(input.commandOptions);
  if (!options.visible) return null;
  return input.tab?.kind === 'firestore-query' ? { tabId: input.tab.id, visible: true } : null;
}
