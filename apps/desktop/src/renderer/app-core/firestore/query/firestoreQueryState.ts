import type {
  FirestoreDocumentResult,
  FirestoreQuery,
  FirestoreQueryDraft,
  PageRequest,
} from '@firebase-desk/repo-contracts';

export type FirestoreResultView = 'json' | 'table' | 'tree';

export type FirestoreInspectorSectionId =
  | 'fieldsInResults'
  | 'jsonContext'
  | 'selectionPreview';

export interface FirestoreInspectorSectionState {
  readonly fieldsInResults: boolean;
  readonly jsonContext: boolean;
  readonly selectionPreview: boolean;
}

export interface FirestoreInspectorUiState {
  readonly overviewCollapsed: boolean;
  readonly resultView: FirestoreResultView;
  readonly resultTreeExpandedIds: ReadonlyArray<string> | null;
  readonly sections: FirestoreInspectorSectionState;
  readonly selectionPreviewExpandedPathsByDocumentPath: Readonly<
    Record<string, ReadonlyArray<string>>
  >;
}

export interface SubmittedFirestoreQuery {
  readonly draft: FirestoreQueryDraft;
  readonly limit: number;
  readonly query: FirestoreQuery;
  readonly requestId: number;
  readonly runId: number;
  readonly token: FirestoreQueryExecutionToken;
}

export interface FirestoreQueryExecutionToken {
  readonly connectionId: string;
  readonly epoch: number;
  readonly path: string;
  readonly requestId: number;
  readonly tabId: string;
}

export interface SubmittedFirestoreSubcollectionLoad {
  readonly documentPath: string;
  readonly execution: SubmittedFirestoreQuery;
  readonly token: FirestoreSubcollectionExecutionToken;
}

export interface FirestoreSubcollectionExecutionToken {
  readonly documentPath: string;
  readonly queryToken: FirestoreQueryExecutionToken;
}

export interface FirestoreQueryPage {
  readonly items: ReadonlyArray<FirestoreDocumentResult>;
  readonly nextCursor?: PageRequest['cursor'];
}

interface FirestoreQueryResultStateBase {
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly pages: ReadonlyArray<FirestoreQueryPage>;
  readonly resultsStale: boolean;
}

export interface FirestoreQueryIdleState extends FirestoreQueryResultStateBase {
  readonly errorMessage: null;
  readonly execution: null;
  readonly status: 'idle';
}

export interface FirestoreQueryLoadingState extends FirestoreQueryResultStateBase {
  readonly errorMessage: null;
  readonly execution: SubmittedFirestoreQuery;
  readonly status: 'loading';
}

export interface FirestoreQuerySuccessState extends FirestoreQueryResultStateBase {
  readonly errorMessage: null;
  readonly execution: SubmittedFirestoreQuery;
  readonly status: 'success';
}

export interface FirestoreQueryErrorState extends FirestoreQueryResultStateBase {
  readonly errorMessage: string;
  readonly execution: SubmittedFirestoreQuery;
  readonly status: 'error';
}

export type FirestoreQueryResultState =
  | FirestoreQueryErrorState
  | FirestoreQueryIdleState
  | FirestoreQueryLoadingState
  | FirestoreQuerySuccessState;

export interface FirestoreQueryRuntimeState {
  readonly nextRequestId: number;
  readonly pendingPageReloads: Readonly<Record<string, number>>;
  readonly queryRequests: Readonly<Record<string, SubmittedFirestoreQuery | null>>;
  readonly recordedQueryCompletions: Readonly<Record<string, true>>;
  readonly resultsByTab: Readonly<Record<string, FirestoreQueryResultState>>;
  readonly selectedDocumentPaths: Readonly<Record<string, string>>;
  readonly subcollectionRequests: Readonly<Record<string, SubmittedFirestoreSubcollectionLoad>>;
  readonly tabEpochs: Readonly<Record<string, number>>;
}

export function createInitialFirestoreQueryRuntimeState(): FirestoreQueryRuntimeState {
  return {
    nextRequestId: 1,
    pendingPageReloads: {},
    queryRequests: {},
    recordedQueryCompletions: {},
    resultsByTab: {},
    selectedDocumentPaths: {},
    subcollectionRequests: {},
    tabEpochs: {},
  };
}

export function defaultFirestoreInspectorUiState(): FirestoreInspectorUiState {
  return {
    overviewCollapsed: false,
    resultView: 'table',
    resultTreeExpandedIds: null,
    sections: {
      fieldsInResults: false,
      jsonContext: true,
      selectionPreview: true,
    },
    selectionPreviewExpandedPathsByDocumentPath: {},
  };
}

export function emptyFirestoreQueryResultState(): FirestoreQueryResultState {
  return {
    errorMessage: null,
    execution: null,
    hasMore: false,
    isFetchingMore: false,
    pages: [],
    resultsStale: false,
    status: 'idle',
  };
}
