import type {
  FirestoreDocumentResult,
  FirestoreSaveDocumentResult,
  FirestoreUpdateDocumentFieldsResult,
} from '@firebase-desk/repo-contracts';
import { describe, expect, it } from 'vitest';
import {
  selectCreateDocumentModalModel,
  selectFirestoreWriteCommandAvailability,
} from './firestoreWriteSelectors.ts';
import { createInitialFirestoreWriteState } from './firestoreWriteState.ts';
import {
  firestoreCreateDocumentRequested,
  firestoreCreateDocumentRequestHandled,
  firestoreCreateDocumentScopeInvalidated,
  firestoreCreateFailed,
  firestoreCreateStarted,
  firestoreCreateSucceeded,
  firestoreDeleteConfirming,
  firestoreDeleteFailed,
  firestoreDeleteStarted,
  firestoreDeleteSucceeded,
  firestoreFieldPatchEditing,
  firestoreFieldPatchFailed,
  firestoreFieldPatchStarted,
  firestoreFieldPatchSucceeded,
  firestoreGenerateDocumentIdFailed,
  firestoreGenerateDocumentIdStarted,
  firestoreGenerateDocumentIdSucceeded,
  firestoreSaveEditing,
  firestoreSaveFailed,
  firestoreSaveStarted,
  firestoreSaveSucceeded,
} from './firestoreWriteTransitions.ts';

describe('firestore write transitions', () => {
  it('tracks create requests and create workflow state', () => {
    const requested = firestoreCreateDocumentRequested(createInitialFirestoreWriteState(), {
      collectionPath: 'orders',
      connectionId: 'emu',
      requestId: 2,
      tabId: 'tab-1',
    });
    expect(requested.pendingCreateDocumentRequest?.requestId).toBe(2);
    expect(requested.create.status).toBe('editing');
    expect(firestoreCreateDocumentRequestHandled(requested, 1)).toBe(requested);
    expect(firestoreCreateDocumentScopeInvalidated(requested, 'other-tab')).toBe(requested);
    expect(
      firestoreCreateDocumentScopeInvalidated(requested, 'tab-1').pendingCreateDocumentRequest,
    ).toBeNull();
    expect(
      firestoreCreateDocumentRequestHandled(requested, 2).pendingCreateDocumentRequest,
    ).toBeNull();

    const generating = firestoreGenerateDocumentIdStarted(requested, 'orders');
    expect(generating.create.status).toBe('generating-id');
    expect(firestoreGenerateDocumentIdSucceeded(generating, 'ord_new').create).toMatchObject({
      documentId: 'ord_new',
      status: 'editing',
    });
    expect(firestoreGenerateDocumentIdFailed(generating, 'orders', 'failed').create.status).toBe(
      'failed',
    );

    const started = firestoreCreateStarted(requested, 'orders/ord_1');
    expect(started.create).toEqual({ documentPath: 'orders/ord_1', status: 'creating' });
    expect(firestoreCreateSucceeded(started, document()).create.status).toBe('created');
    expect(firestoreCreateFailed(started, 'orders/ord_1', 'failed').create).toEqual({
      documentPath: 'orders/ord_1',
      errorMessage: 'failed',
      status: 'failed',
    });
  });

  it('tracks full document save states', () => {
    expect(firestoreSaveEditing(createInitialFirestoreWriteState(), 'orders/ord_1').save.status)
      .toBe('editing');
    const started = firestoreSaveStarted(createInitialFirestoreWriteState(), 'orders/ord_1');
    expect(started.save.status).toBe('saving');

    const savedResult: FirestoreSaveDocumentResult = { document: document(), status: 'saved' };
    expect(firestoreSaveSucceeded(started, 'orders/ord_1', savedResult).save.status).toBe('saved');

    const conflictResult: FirestoreSaveDocumentResult = {
      remoteDocument: document(),
      status: 'conflict',
    };
    expect(firestoreSaveSucceeded(started, 'orders/ord_1', conflictResult).save.status).toBe(
      'conflict',
    );
    expect(firestoreSaveFailed(started, 'orders/ord_1', 'failed').save.status).toBe('failed');
  });

  it('tracks field patch states', () => {
    expect(
      firestoreFieldPatchEditing(createInitialFirestoreWriteState(), 'orders/ord_1', ['status'])
        .fieldPatch,
    ).toMatchObject({ fieldPath: ['status'], status: 'editing' });
    const started = firestoreFieldPatchStarted(createInitialFirestoreWriteState(), 'orders/ord_1');
    const saved: FirestoreUpdateDocumentFieldsResult = { document: document(), status: 'saved' };
    expect(firestoreFieldPatchSucceeded(started, 'orders/ord_1', saved).fieldPatch.status).toBe(
      'saved',
    );

    const conflict: FirestoreUpdateDocumentFieldsResult = {
      remoteDocument: document(),
      status: 'conflict',
    };
    expect(firestoreFieldPatchSucceeded(started, 'orders/ord_1', conflict).fieldPatch.status)
      .toBe('conflict');
    expect(firestoreFieldPatchFailed(started, 'orders/ord_1', 'failed').fieldPatch.status).toBe(
      'failed',
    );
  });

  it('tracks delete states', () => {
    expect(
      firestoreDeleteConfirming(createInitialFirestoreWriteState(), 'orders/ord_1')
        .deleteDocument.status,
    ).toBe('confirming');
    const started = firestoreDeleteStarted(createInitialFirestoreWriteState(), 'orders/ord_1');
    expect(started.deleteDocument.status).toBe('deleting');
    expect(firestoreDeleteSucceeded(started, 'orders/ord_1').deleteDocument.status).toBe(
      'deleted',
    );
    expect(firestoreDeleteFailed(started, 'orders/ord_1', 'failed').deleteDocument).toEqual({
      documentPath: 'orders/ord_1',
      errorMessage: 'failed',
      status: 'failed',
    });
  });

  it('selects modal props and command availability', () => {
    const requested = firestoreCreateDocumentRequested(createInitialFirestoreWriteState(), {
      collectionPath: 'orders',
      connectionId: 'emu',
      requestId: 2,
      tabId: 'tab-1',
    });
    const creating = firestoreCreateStarted(requested, 'orders/ord_1');

    expect(selectCreateDocumentModalModel(creating, 'tab-1', 'emu')).toMatchObject({
      errorMessage: null,
      isCreating: true,
      request: { collectionPath: 'orders', requestId: 2, tabId: 'tab-1' },
    });
    expect(selectCreateDocumentModalModel(creating, 'tab-2', 'emu')).toBeNull();
    expect(selectCreateDocumentModalModel(creating, 'tab-1', 'prod')).toBeNull();
    expect(selectCreateDocumentModalModel(creating, 'tab-1')).toBeNull();
    expect(selectFirestoreWriteCommandAvailability(creating)).toMatchObject({
      canCreateDocument: false,
      canDeleteDocument: true,
      canSaveDocument: true,
      canUpdateField: true,
    });
  });
});

function document(): FirestoreDocumentResult {
  return { data: {}, hasSubcollections: false, id: 'ord_1', path: 'orders/ord_1' };
}
