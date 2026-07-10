import type {
  FirestoreDocumentResult,
  FirestoreSaveDocumentResult,
  FirestoreUpdateDocumentFieldsResult,
} from '@firebase-desk/repo-contracts';
import type { FirestoreWriteState, PendingCreateDocumentRequest } from './firestoreWriteState.ts';

export function firestoreCreateDocumentRequested(
  state: FirestoreWriteState,
  request: PendingCreateDocumentRequest,
): FirestoreWriteState {
  return {
    ...state,
    create: { documentId: '', request, status: 'editing' },
    pendingCreateDocumentRequest: request,
  };
}

export function firestoreCreateDocumentRequestHandled(
  state: FirestoreWriteState,
  requestId: number,
): FirestoreWriteState {
  return state.pendingCreateDocumentRequest?.requestId === requestId
    ? { ...state, pendingCreateDocumentRequest: null }
    : state;
}

export function firestoreCreateDocumentScopeInvalidated(
  state: FirestoreWriteState,
  tabId: string,
): FirestoreWriteState {
  return state.pendingCreateDocumentRequest?.tabId === tabId
    ? { ...state, pendingCreateDocumentRequest: null }
    : state;
}

export function firestoreCreateStarted(
  state: FirestoreWriteState,
  documentPath: string,
): FirestoreWriteState {
  return { ...state, create: { documentPath, status: 'creating' } };
}

export function firestoreGenerateDocumentIdStarted(
  state: FirestoreWriteState,
  collectionPath: string,
): FirestoreWriteState {
  return { ...state, create: { collectionPath, status: 'generating-id' } };
}

export function firestoreGenerateDocumentIdSucceeded(
  state: FirestoreWriteState,
  documentId: string,
): FirestoreWriteState {
  if (state.create.status !== 'generating-id') return state;
  const request = state.pendingCreateDocumentRequest;
  return request
    ? { ...state, create: { documentId, request, status: 'editing' } }
    : state;
}

export function firestoreGenerateDocumentIdFailed(
  state: FirestoreWriteState,
  collectionPath: string,
  errorMessage: string,
): FirestoreWriteState {
  return {
    ...state,
    create: {
      documentPath: collectionPath,
      errorMessage,
      status: 'failed',
    },
  };
}

export function firestoreCreateSucceeded(
  state: FirestoreWriteState,
  document: FirestoreDocumentResult,
): FirestoreWriteState {
  return { ...state, create: { document, status: 'created' } };
}

export function firestoreCreateFailed(
  state: FirestoreWriteState,
  documentPath: string,
  errorMessage: string,
): FirestoreWriteState {
  return { ...state, create: { documentPath, errorMessage, status: 'failed' } };
}

export function firestoreSaveStarted(
  state: FirestoreWriteState,
  documentPath: string,
): FirestoreWriteState {
  return { ...state, save: { documentPath, status: 'saving' } };
}

export function firestoreSaveEditing(
  state: FirestoreWriteState,
  documentPath: string,
): FirestoreWriteState {
  return { ...state, save: { documentPath, status: 'editing' } };
}

export function firestoreSaveSucceeded(
  state: FirestoreWriteState,
  documentPath: string,
  result: FirestoreSaveDocumentResult,
): FirestoreWriteState {
  return {
    ...state,
    save: { documentPath, result, status: result.status === 'conflict' ? 'conflict' : 'saved' },
  };
}

export function firestoreSaveFailed(
  state: FirestoreWriteState,
  documentPath: string,
  errorMessage: string,
): FirestoreWriteState {
  return { ...state, save: { documentPath, errorMessage, status: 'failed' } };
}

export function firestoreFieldPatchStarted(
  state: FirestoreWriteState,
  documentPath: string,
): FirestoreWriteState {
  return { ...state, fieldPatch: { documentPath, status: 'saving' } };
}

export function firestoreFieldPatchEditing(
  state: FirestoreWriteState,
  documentPath: string,
  fieldPath: ReadonlyArray<string>,
): FirestoreWriteState {
  return { ...state, fieldPatch: { documentPath, fieldPath, status: 'editing' } };
}

export function firestoreFieldPatchSucceeded(
  state: FirestoreWriteState,
  documentPath: string,
  result: FirestoreUpdateDocumentFieldsResult,
): FirestoreWriteState {
  return {
    ...state,
    fieldPatch: { documentPath, result, status: result.status },
  };
}

export function firestoreFieldPatchFailed(
  state: FirestoreWriteState,
  documentPath: string,
  errorMessage: string,
): FirestoreWriteState {
  return { ...state, fieldPatch: { documentPath, errorMessage, status: 'failed' } };
}

export function firestoreDeleteStarted(
  state: FirestoreWriteState,
  documentPath: string,
): FirestoreWriteState {
  return { ...state, deleteDocument: { documentPath, status: 'deleting' } };
}

export function firestoreDeleteConfirming(
  state: FirestoreWriteState,
  documentPath: string,
): FirestoreWriteState {
  return { ...state, deleteDocument: { documentPath, status: 'confirming' } };
}

export function firestoreDeleteSucceeded(
  state: FirestoreWriteState,
  documentPath: string,
): FirestoreWriteState {
  return { ...state, deleteDocument: { documentPath, status: 'deleted' } };
}

export function firestoreDeleteFailed(
  state: FirestoreWriteState,
  documentPath: string,
  errorMessage: string,
): FirestoreWriteState {
  return { ...state, deleteDocument: { documentPath, errorMessage, status: 'failed' } };
}
