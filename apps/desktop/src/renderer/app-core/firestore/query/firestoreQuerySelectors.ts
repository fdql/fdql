import type {
  FirestoreDocumentResult,
  FirestoreQuery,
  FirestoreQueryDraft,
} from '@firebase-desk/repo-contracts';
import {
  emptyFirestoreQueryResultState,
  type FirestoreQueryResultState,
  type FirestoreQueryRuntimeState,
  type SubmittedFirestoreQuery,
} from './firestoreQueryState.ts';

interface FirestoreQueryTabLike {
  readonly id: string;
  readonly kind: string;
}

export function selectFirestoreActiveQueryRequest(
  state: FirestoreQueryRuntimeState,
  tab: FirestoreQueryTabLike | undefined,
  activeConnectionId: string | null | undefined,
) {
  const request = tab?.kind === 'firestore-query' ? state.queryRequests[tab.id] ?? null : null;
  return request?.query.connectionId === activeConnectionId ? request : null;
}

export function isCurrentFirestoreQueryExecution(
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

export function selectFirestoreResultExecution(
  state: FirestoreQueryRuntimeState,
  tab: FirestoreQueryTabLike | undefined,
): SubmittedFirestoreQuery | null {
  return selectFirestoreTabResultState(state, tab).execution;
}

export function selectFirestoreResultRows(
  pages: ReadonlyArray<{ readonly items: ReadonlyArray<FirestoreDocumentResult>; }>,
): ReadonlyArray<FirestoreDocumentResult> {
  return pages.flatMap((page) => page.items);
}

export function selectFirestoreTabResultState(
  state: FirestoreQueryRuntimeState,
  tab: FirestoreQueryTabLike | undefined,
): FirestoreQueryResultState {
  return tab?.kind === 'firestore-query'
    ? state.resultsByTab[tab.id] ?? emptyFirestoreQueryResultState()
    : emptyFirestoreQueryResultState();
}

export function selectFirestoreSelectedDocument(
  rows: ReadonlyArray<FirestoreDocumentResult>,
  selectedPath: string | null,
): FirestoreDocumentResult | null {
  return rows.find((row) => row.path === selectedPath) ?? null;
}

export function selectFirestoreLoadedPageCount(
  pages: ReadonlyArray<unknown>,
  isDocumentQuery: boolean,
  hasDocument: boolean,
): number {
  return isDocumentQuery ? (hasDocument ? 1 : 0) : pages.length;
}

export function firestoreQueryDraftMetadata(draft: FirestoreQueryDraft): Record<string, unknown> {
  return {
    filters: (draft.filters ?? []).map((filter) => ({
      field: filter.field,
      op: filter.op,
      valueType: firestoreQueryValueKind(filter.value),
    })),
    limit: draft.limit,
    path: draft.path,
    sort: draft.sortField
      ? { direction: draft.sortDirection, field: draft.sortField }
      : null,
  };
}

export function firestoreQueryMetadata(
  query: FirestoreQuery,
  limit: number,
): Record<string, unknown> {
  const firstSort = query.sorts?.[0];
  return {
    filters: (query.filters ?? []).map((filter) => ({
      field: filter.field,
      op: filter.op,
      valueType: firestoreQueryValueKind(filter.value),
    })),
    limit,
    path: query.path,
    sort: firstSort
      ? { direction: firstSort.direction, field: firstSort.field }
      : null,
  };
}

function firestoreQueryValueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}
