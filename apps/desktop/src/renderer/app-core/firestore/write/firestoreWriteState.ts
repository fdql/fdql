import type {
  FirestoreDocumentResult,
  FirestoreSaveDocumentResult,
  FirestoreUpdateDocumentFieldsResult,
} from '@firebase-desk/repo-contracts';

export interface PendingCreateDocumentRequest {
  readonly collectionPath: string;
  readonly collectionPathEditable?: boolean;
  readonly connectionId: string;
  readonly requestId: number;
  readonly tabId: string;
}

export type FirestoreCreateWorkflowState =
  | { readonly status: 'idle'; }
  | { readonly collectionPath: string; readonly status: 'generating-id'; }
  | {
    readonly documentId: string;
    readonly request: PendingCreateDocumentRequest;
    readonly status: 'editing';
  }
  | { readonly documentPath: string; readonly status: 'creating'; }
  | { readonly document: FirestoreDocumentResult; readonly status: 'created'; }
  | { readonly documentPath: string; readonly errorMessage: string; readonly status: 'failed'; };

export type FirestoreSaveWorkflowState =
  | { readonly status: 'idle'; }
  | { readonly documentPath: string; readonly status: 'editing'; }
  | { readonly documentPath: string; readonly status: 'saving'; }
  | {
    readonly documentPath: string;
    readonly result: FirestoreSaveDocumentResult;
    readonly status: 'saved' | 'conflict';
  }
  | { readonly documentPath: string; readonly errorMessage: string; readonly status: 'failed'; };

export type FirestoreFieldPatchWorkflowState =
  | { readonly status: 'idle'; }
  | {
    readonly documentPath: string;
    readonly fieldPath: ReadonlyArray<string>;
    readonly status: 'editing';
  }
  | { readonly documentPath: string; readonly status: 'saving'; }
  | {
    readonly documentPath: string;
    readonly result: FirestoreUpdateDocumentFieldsResult;
    readonly status: 'saved' | 'document-changed' | 'conflict';
  }
  | { readonly documentPath: string; readonly errorMessage: string; readonly status: 'failed'; };

export type FirestoreDeleteWorkflowState =
  | { readonly status: 'idle'; }
  | { readonly documentPath: string; readonly status: 'confirming'; }
  | { readonly documentPath: string; readonly status: 'deleting'; }
  | { readonly documentPath: string; readonly status: 'deleted'; }
  | { readonly documentPath: string; readonly errorMessage: string; readonly status: 'failed'; };

export interface FirestoreWriteState {
  readonly create: FirestoreCreateWorkflowState;
  readonly deleteDocument: FirestoreDeleteWorkflowState;
  readonly fieldPatch: FirestoreFieldPatchWorkflowState;
  readonly pendingCreateDocumentRequest: PendingCreateDocumentRequest | null;
  readonly save: FirestoreSaveWorkflowState;
}

export function createInitialFirestoreWriteState(): FirestoreWriteState {
  return {
    create: { status: 'idle' },
    deleteDocument: { status: 'idle' },
    fieldPatch: { status: 'idle' },
    pendingCreateDocumentRequest: null,
    save: { status: 'idle' },
  };
}
