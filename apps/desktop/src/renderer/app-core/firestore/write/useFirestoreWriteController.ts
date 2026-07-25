import type {
  DataMode,
  FirestoreDeleteDocumentOptions,
  FirestoreFieldPatchOperation,
  FirestoreRepository,
  FirestoreSaveDocumentOptions,
  FirestoreSaveDocumentResult,
  FirestoreUpdateDocumentFieldsOptions,
  FirestoreUpdateDocumentFieldsResult,
  ProjectSummary,
} from '@firebase-desk/repo-contracts';
import { useMemo } from 'react';
import { messageFromError } from '../../shared/errors.ts';
import { useAppCoreSelector } from '../../shared/reactStore.ts';
import {
  createFirestoreDocumentCommand,
  deleteFirestoreDocumentCommand,
  type FirestoreWriteCommandEnvironment,
  generateFirestoreDocumentIdCommand,
  saveFirestoreDocumentCommand,
  updateFirestoreDocumentFieldsCommand,
} from './firestoreWriteCommands.ts';
import { selectCreateDocumentRequestForTab } from './firestoreWriteSelectors.ts';
import type { PendingCreateDocumentRequest } from './firestoreWriteState.ts';
import { createFirestoreWriteStore, type FirestoreWriteStore } from './firestoreWriteStore.ts';
import {
  firestoreCreateDocumentRequested,
  firestoreCreateDocumentRequestHandled,
  firestoreCreateDocumentScopeInvalidated,
} from './firestoreWriteTransitions.ts';

interface FirestoreWriteTabLike {
  readonly id: string;
  readonly kind: string;
}

export interface UseFirestoreWriteControllerInput {
  readonly activeProject: ProjectSummary | null;
  readonly activeTab: FirestoreWriteTabLike | undefined;
  readonly dataMode: DataMode;
  readonly firestore: Pick<
    FirestoreRepository,
    | 'createDocument'
    | 'deleteDocument'
    | 'generateDocumentId'
    | 'saveDocument'
    | 'updateDocumentFields'
  >;
  readonly onStatus: (message: string) => void;
  readonly recordActivity: FirestoreWriteCommandEnvironment['recordActivity'];
  readonly refreshAfterLiveWrite: () => Promise<void>;
  readonly resultProject?: ProjectSummary | null | undefined;
  readonly store?: FirestoreWriteStore | undefined;
}

export interface FirestoreWriteController {
  readonly createDocument: (
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
  readonly createDocumentRequest: PendingCreateDocumentRequest | null;
  readonly clearTabScope: (tabId: string) => void;
  readonly deleteDocument: (
    documentPath: string,
    options: FirestoreDeleteDocumentOptions,
  ) => Promise<void>;
  readonly generateDocumentId: (collectionPath: string) => Promise<string>;
  readonly handleCreateDocumentRequestHandled: (requestId: number) => void;
  readonly requestCreateDocument: (request: PendingCreateDocumentRequest) => void;
  readonly saveDocument: (
    documentPath: string,
    data: Record<string, unknown>,
    options?: FirestoreSaveDocumentOptions,
  ) => Promise<FirestoreSaveDocumentResult>;
  readonly store: FirestoreWriteStore;
  readonly updateDocumentFields: (
    documentPath: string,
    operations: ReadonlyArray<FirestoreFieldPatchOperation>,
    options: FirestoreUpdateDocumentFieldsOptions,
  ) => Promise<FirestoreUpdateDocumentFieldsResult>;
}

export function useFirestoreWriteController(
  input: UseFirestoreWriteControllerInput,
): FirestoreWriteController {
  const store = useMemo(() => input.store ?? createFirestoreWriteStore(), [input.store]);
  const state = useAppCoreSelector(store, (snapshot) => snapshot);
  const currentProject = input.activeProject
    ? { connectionId: input.activeProject.id, projectId: input.activeProject.projectId }
    : null;
  const resultTarget = input.resultProject === undefined
    ? input.activeProject
    : input.resultProject;
  const resultProject = resultTarget
    ? { connectionId: resultTarget.id, projectId: resultTarget.projectId }
    : null;
  const env: FirestoreWriteCommandEnvironment = {
    dataMode: input.dataMode,
    firestore: input.firestore,
    now: Date.now,
    recordActivity: input.recordActivity,
    refreshAfterLiveWrite: input.refreshAfterLiveWrite,
  };

  function requestCreateDocument(request: PendingCreateDocumentRequest) {
    store.update((current) => firestoreCreateDocumentRequested(current, request));
  }

  function handleCreateDocumentRequestHandled(requestId: number) {
    store.update((current) => firestoreCreateDocumentRequestHandled(current, requestId));
  }

  function clearTabScope(tabId: string) {
    store.update((current) => firestoreCreateDocumentScopeInvalidated(current, tabId));
  }

  async function generateDocumentId(collectionPath: string): Promise<string> {
    return await generateFirestoreDocumentIdCommand(env, {
      collectionPath,
      project: currentProject,
    });
  }

  async function createDocument(
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const result = await createFirestoreDocumentCommand(store, env, {
        collectionPath,
        data,
        documentId,
        project: currentProject,
      });
      if (result.notification) input.onStatus(result.notification);
    } catch (error) {
      input.onStatus(`Create failed: ${messageFromError(error, 'Could not create document.')}`);
      throw error;
    }
  }

  async function saveDocument(
    documentPath: string,
    data: Record<string, unknown>,
    options?: FirestoreSaveDocumentOptions,
  ): Promise<FirestoreSaveDocumentResult> {
    try {
      const result = await saveFirestoreDocumentCommand(store, env, {
        data,
        documentPath,
        options,
        project: resultProject,
      });
      if (result.notification) input.onStatus(result.notification);
      return result.result;
    } catch (error) {
      input.onStatus(`Save failed: ${messageFromError(error, 'Could not save document.')}`);
      throw error;
    }
  }

  async function updateDocumentFields(
    documentPath: string,
    operations: ReadonlyArray<FirestoreFieldPatchOperation>,
    options: FirestoreUpdateDocumentFieldsOptions,
  ): Promise<FirestoreUpdateDocumentFieldsResult> {
    try {
      const result = await updateFirestoreDocumentFieldsCommand(store, env, {
        documentPath,
        operations,
        options,
        project: resultProject,
      });
      if (result.notification) input.onStatus(result.notification);
      return result.result;
    } catch (error) {
      input.onStatus(`Update failed: ${messageFromError(error, 'Could not update fields.')}`);
      throw error;
    }
  }

  async function deleteDocument(
    documentPath: string,
    options: FirestoreDeleteDocumentOptions,
  ): Promise<void> {
    try {
      const result = await deleteFirestoreDocumentCommand(store, env, {
        deleteSubcollectionPaths: options.deleteSubcollectionPaths,
        documentPath,
        project: resultProject,
      });
      if (result.notification) input.onStatus(result.notification);
    } catch (error) {
      input.onStatus(`Delete failed: ${messageFromError(error, 'Could not delete document.')}`);
      throw error;
    }
  }

  return {
    createDocument,
    createDocumentRequest: selectCreateDocumentRequestForTab(
      state,
      input.activeTab?.id,
      input.activeProject?.id,
    ),
    clearTabScope,
    deleteDocument,
    generateDocumentId,
    handleCreateDocumentRequestHandled,
    requestCreateDocument,
    saveDocument,
    store,
    updateDocumentFields,
  };
}
