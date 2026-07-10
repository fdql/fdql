import type { FirestoreWriteState } from './firestoreWriteState.ts';

export interface FirestoreCreateDocumentModalModel {
  readonly errorMessage: string | null;
  readonly isCreating: boolean;
  readonly request: NonNullable<FirestoreWriteState['pendingCreateDocumentRequest']>;
}

export interface FirestoreWriteCommandAvailability {
  readonly canCreateDocument: boolean;
  readonly canDeleteDocument: boolean;
  readonly canSaveDocument: boolean;
  readonly canUpdateField: boolean;
}

export function selectCreateDocumentRequestForTab(
  state: FirestoreWriteState,
  tabId: string | null | undefined,
  connectionId?: string | null | undefined,
) {
  if (!tabId || !connectionId) return null;
  return state.pendingCreateDocumentRequest?.tabId === tabId
      && state.pendingCreateDocumentRequest.connectionId === connectionId
    ? state.pendingCreateDocumentRequest
    : null;
}

export function selectCreateDocumentModalModel(
  state: FirestoreWriteState,
  tabId: string | null | undefined,
  connectionId?: string | null | undefined,
): FirestoreCreateDocumentModalModel | null {
  const request = selectCreateDocumentRequestForTab(state, tabId, connectionId);
  if (!request) return null;
  return {
    errorMessage: state.create.status === 'failed' ? state.create.errorMessage : null,
    isCreating: state.create.status === 'creating',
    request,
  };
}

export function selectFirestoreWriteCommandAvailability(
  state: FirestoreWriteState,
): FirestoreWriteCommandAvailability {
  return {
    canCreateDocument: state.create.status !== 'creating'
      && state.create.status !== 'generating-id',
    canDeleteDocument: state.deleteDocument.status !== 'deleting',
    canSaveDocument: state.save.status !== 'saving',
    canUpdateField: state.fieldPatch.status !== 'saving',
  };
}

export function fieldPatchStatusLabel(status: 'conflict' | 'document-changed'): string {
  return status === 'conflict' ? 'Field conflict' : 'Document changed elsewhere';
}
