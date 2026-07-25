import type { DensityName } from '@firebase-desk/design-tokens';
import type {
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreFieldPatchOperation,
  FirestoreFieldStaleBehavior,
  FirestoreQueryDraft,
  FirestoreQueryDraftEdit,
  FirestoreSaveDocumentOptions,
  FirestoreSaveDocumentResult,
  FirestoreUpdateDocumentFieldsOptions,
  FirestoreUpdateDocumentFieldsResult,
  ProjectSummary,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import { normalizeFirestoreWriteSettings } from '@firebase-desk/repo-contracts';
import type {
  FirestoreCollectionJobRequest,
  FirestoreExportFormat,
} from '@firebase-desk/repo-contracts/jobs';
import { useEffect, useRef, useState } from 'react';
import { messageFromError } from '../../shared/errors.ts';
import { CollectionJobDialog } from './CollectionJobDialog.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { ConflictMergeModal } from './ConflictMergeModal.tsx';
import { CreateDocumentModal } from './CreateDocumentModal.tsx';
import { DeleteDocumentDialog } from './DeleteDocumentDialog.tsx';
import type { DeleteDocumentOptions } from './deleteDocumentModel.ts';
import { DocumentEditorModal } from './DocumentEditorModal.tsx';
import { useFirestoreFieldCatalog } from './fieldCatalog.ts';
import { FieldEditModal } from './FieldEditModal.tsx';
import {
  deleteNestedFieldValue,
  type FieldEditTarget,
  fieldPathLabel,
  getNestedFieldValue,
  setNestedFieldValue,
  validateFirestoreDocumentData,
  validateFirestoreValue,
} from './fieldEditModel.ts';
import { FirestoreDocumentBrowser } from './FirestoreDocumentBrowser.tsx';
import type { FirestoreInspectorSectionId, FirestoreInspectorUiState } from './inspectorState.ts';
import { QueryBuilder } from './QueryBuilder.tsx';
import { findDocumentByPath, isCollectionPath } from './resultModel.tsx';
import type { FirestoreResultView } from './types.ts';

type ResultViewChangeHandler = (
  resultView: FirestoreResultView,
  scopeKey?: string,
) => void;

export type CollectionJobKind = 'copy' | 'delete' | 'duplicate' | 'export' | 'import';

export interface FirestoreQuerySurfaceProps {
  readonly activeProject?: ProjectSummary | null | undefined;
  readonly collectionJobRequest?: FirestoreCollectionJobDialogRequest | null | undefined;
  readonly createDocumentRequest?: FirestoreCreateDocumentRequest | null | undefined;
  readonly draft: FirestoreQueryDraft;
  readonly density?: DensityName | undefined;
  readonly errorMessage?: string | null;
  readonly hasMore: boolean;
  readonly inspectorUi?: FirestoreInspectorUiState | undefined;
  readonly inspectorWidth?: number | undefined;
  readonly isFetchingMore?: boolean;
  readonly isLoading?: boolean;
  readonly onCreateDocument?: (
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ) => Promise<void> | void;
  readonly onCreateDocumentRequestHandled?: ((requestId: number) => void) | undefined;
  readonly onCollectionJobRequestHandled?: ((requestId: number) => void) | undefined;
  readonly onDeleteDocument?: (
    documentPath: string,
    options: DeleteDocumentOptions,
  ) => Promise<void> | void;
  readonly onDraftEdit: (edit: FirestoreQueryDraftEdit) => void;
  readonly onGenerateDocumentId?: (
    collectionPath: string,
  ) => Promise<string> | string;
  readonly onPickCollectionJobExportFile?:
    | ((format: FirestoreExportFormat) => Promise<string | null> | string | null)
    | undefined;
  readonly onPickCollectionJobImportFile?:
    | (() => Promise<string | null> | string | null)
    | undefined;
  readonly onLoadMore: () => void;
  readonly onLoadSubcollections?: (
    documentPath: string,
  ) => Promise<ReadonlyArray<FirestoreCollectionNode>>;
  readonly onInspectorOverviewCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  readonly onInspectorSectionOpenChange?:
    | ((section: FirestoreInspectorSectionId, open: boolean) => void)
    | undefined;
  readonly onInspectorWidthChange?: ((width: number) => void) | undefined;
  readonly onOpenDocumentInNewTab: (documentPath: string) => void;
  readonly onRefreshResults?: () => void;
  readonly onResultViewChange?: ResultViewChangeHandler | undefined;
  readonly onResultTreeExpandedIdsChange?:
    | ((expandedIds: ReadonlyArray<string>) => void)
    | undefined;
  readonly onResultsStaleChange?: ((stale: boolean, scopeKey?: string) => void) | undefined;
  readonly onResultDocumentDeleted?: ((documentPath: string) => void) | undefined;
  readonly onResultDocumentSaved?: ((document: FirestoreDocumentResult) => void) | undefined;
  readonly onRun: () => void;
  readonly onSaveDocument?: (
    documentPath: string,
    data: Record<string, unknown>,
    options?: FirestoreSaveDocumentOptions,
  ) => Promise<FirestoreSaveDocumentResult | void> | FirestoreSaveDocumentResult | void;
  readonly onUpdateDocumentFields?: (
    documentPath: string,
    operations: ReadonlyArray<FirestoreFieldPatchOperation>,
    options: FirestoreUpdateDocumentFieldsOptions,
  ) =>
    | Promise<FirestoreUpdateDocumentFieldsResult | void>
    | FirestoreUpdateDocumentFieldsResult
    | void;
  readonly onSelectDocument: (documentPath: string) => void;
  readonly onSelectionPreviewExpandedPathsChange?:
    | ((documentPath: string, expandedPaths: ReadonlyArray<string>) => void)
    | undefined;
  readonly onStartCollectionJob?:
    | ((request: FirestoreCollectionJobRequest) => Promise<void> | void)
    | undefined;
  readonly projects?: ReadonlyArray<ProjectSummary> | undefined;
  readonly rows: ReadonlyArray<FirestoreDocumentResult>;
  readonly resultView?: FirestoreResultView | undefined;
  readonly resultQueryPath?: string | null | undefined;
  readonly resultsScopeKey?: string | undefined;
  readonly resultsStale?: boolean | undefined;
  readonly selectedDocument?: FirestoreDocumentResult | null;
  readonly selectedDocumentPath?: string | null;
  readonly settings?: SettingsRepository | undefined;
  readonly targetScopeKey?: string | undefined;
}

export interface FirestoreCreateDocumentRequest {
  readonly collectionPath: string;
  readonly collectionPathEditable?: boolean;
  readonly requestId: number;
}

export interface FirestoreCollectionJobDialogRequest {
  readonly collectionPath: string;
  readonly kind: CollectionJobKind;
  readonly requestId: number;
}

interface CreateDocumentState {
  readonly collectionPath: string;
  readonly collectionPathEditable: boolean;
}

interface ConflictMergeState {
  readonly documentPath: string;
  readonly localData: Record<string, unknown>;
  readonly onResolve?: (() => void) | undefined;
  readonly remoteDocument: FirestoreDocumentResult | null;
}

interface PendingStaleFieldPatch {
  readonly documentPath: string;
  readonly localData: Record<string, unknown>;
  readonly onResolve?: (() => void) | undefined;
  readonly operations: ReadonlyArray<FirestoreFieldPatchOperation>;
  readonly remoteDocument: FirestoreDocumentResult;
}

export function FirestoreQuerySurface(
  {
    activeProject = null,
    collectionJobRequest = null,
    draft,
    createDocumentRequest = null,
    density,
    errorMessage = null,
    hasMore,
    inspectorUi,
    inspectorWidth,
    isFetchingMore = false,
    isLoading = false,
    onCreateDocument,
    onCollectionJobRequestHandled,
    onCreateDocumentRequestHandled,
    onDeleteDocument,
    onDraftEdit,
    onGenerateDocumentId,
    onPickCollectionJobExportFile,
    onPickCollectionJobImportFile,
    onLoadMore,
    onLoadSubcollections,
    onInspectorOverviewCollapsedChange,
    onInspectorSectionOpenChange,
    onInspectorWidthChange,
    onOpenDocumentInNewTab,
    onRefreshResults,
    onResultViewChange,
    onResultTreeExpandedIdsChange,
    onResultsStaleChange,
    onResultDocumentDeleted,
    onResultDocumentSaved,
    onRun,
    onSaveDocument,
    onUpdateDocumentFields,
    onSelectDocument,
    onSelectionPreviewExpandedPathsChange,
    onStartCollectionJob,
    projects = [],
    rows,
    resultView,
    resultQueryPath,
    resultsScopeKey,
    resultsStale,
    selectedDocument = null,
    selectedDocumentPath = null,
    settings,
    targetScopeKey,
  }: FirestoreQuerySurfaceProps,
) {
  const [uncontrolledResultView, setUncontrolledResultView] = useState<FirestoreResultView>(
    'table',
  );
  const [editorDocument, setEditorDocument] = useState<FirestoreDocumentResult | null>(null);
  const [fieldEditor, setFieldEditor] = useState<FieldEditTarget | null>(null);
  const [deleteDocumentTarget, setDeleteDocumentTarget] = useState<FirestoreDocumentResult | null>(
    null,
  );
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<FieldEditTarget | null>(null);
  const [createDocumentState, setCreateDocumentState] = useState<CreateDocumentState | null>(null);
  const [collectionJob, setCollectionJob] = useState<
    {
      readonly collectionPath: string;
      readonly kind: CollectionJobKind;
    } | null
  >(null);
  const [handledCreateRequestId, setHandledCreateRequestId] = useState<number | null>(null);
  const [handledCollectionJobRequestId, setHandledCollectionJobRequestId] = useState<number | null>(
    null,
  );
  const [conflictMerge, setConflictMerge] = useState<ConflictMergeState | null>(null);
  const [pendingStaleFieldPatch, setPendingStaleFieldPatch] = useState<
    PendingStaleFieldPatch | null
  >(null);
  const [uncontrolledResultsStale, setUncontrolledResultsStale] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [actionNoticeMessage, setActionNoticeMessage] = useState<string | null>(null);
  const [dialogScopeKey, setDialogScopeKey] = useState(targetScopeKey);
  const effectiveResultView = resultView ?? uncontrolledResultView;
  const effectiveResultsStale = resultsStale ?? uncontrolledResultsStale;
  const onResultViewChangeRef = useRef(onResultViewChange);
  const onResultsStaleChangeRef = useRef(onResultsStaleChange);
  const resultsScopeKeyRef = useRef(resultsScopeKey);
  const previousTargetScopeKeyRef = useRef(targetScopeKey);
  const dialogScopeIsCurrent = dialogScopeKey === targetScopeKey;
  const fieldSuggestions = useFirestoreFieldCatalog({
    onSettingsError: setActionErrorMessage,
    observationQueryPath: resultQueryPath,
    queryPath: draft.path,
    rows,
    settings,
  });
  // Field-level actions require patch writes; falling back to full saves would overwrite documents.
  const fieldActionsEnabled = Boolean(onUpdateDocumentFields);

  useEffect(() => {
    if (previousTargetScopeKeyRef.current === targetScopeKey) return;
    previousTargetScopeKeyRef.current = targetScopeKey;
    setDialogScopeKey(targetScopeKey);
    setEditorDocument(null);
    setFieldEditor(null);
    setDeleteDocumentTarget(null);
    setDeleteFieldTarget(null);
    setCreateDocumentState(null);
    setCollectionJob(null);
    setConflictMerge(null);
    setPendingStaleFieldPatch(null);
    setActionErrorMessage(null);
    setActionNoticeMessage(null);
  }, [targetScopeKey]);

  useEffect(() => {
    if (!createDocumentRequest || createDocumentRequest.requestId === handledCreateRequestId) {
      return;
    }
    setHandledCreateRequestId(createDocumentRequest.requestId);
    setDialogScopeKey(targetScopeKey);
    setCreateDocumentState({
      collectionPath: createDocumentRequest.collectionPath,
      collectionPathEditable: createDocumentRequest.collectionPathEditable ?? false,
    });
    onCreateDocumentRequestHandled?.(createDocumentRequest.requestId);
  }, [
    createDocumentRequest,
    handledCreateRequestId,
    onCreateDocumentRequestHandled,
    targetScopeKey,
  ]);

  useEffect(() => {
    if (!collectionJobRequest || collectionJobRequest.requestId === handledCollectionJobRequestId) {
      return;
    }
    setHandledCollectionJobRequestId(collectionJobRequest.requestId);
    setDialogScopeKey(targetScopeKey);
    setCollectionJob({
      collectionPath: collectionJobRequest.collectionPath,
      kind: collectionJobRequest.kind,
    });
    onCollectionJobRequestHandled?.(collectionJobRequest.requestId);
  }, [
    collectionJobRequest,
    handledCollectionJobRequestId,
    onCollectionJobRequestHandled,
    targetScopeKey,
  ]);

  useEffect(() => {
    onResultViewChangeRef.current = onResultViewChange;
    onResultsStaleChangeRef.current = onResultsStaleChange;
    resultsScopeKeyRef.current = resultsScopeKey;
  }, [onResultViewChange, onResultsStaleChange, resultsScopeKey]);

  async function createDocument(
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ) {
    validateFirestoreDocumentData(data);
    await onCreateDocument?.(collectionPath, documentId, data);
    setResultsStaleState(true);
    setActionErrorMessage(null);
    setActionNoticeMessage(null);
  }

  async function saveDocument(
    documentPath: string,
    data: Record<string, unknown>,
    options?: FirestoreSaveDocumentOptions,
    conflictContext?: { readonly onResolve?: (() => void) | undefined; },
  ): Promise<boolean> {
    validateFirestoreDocumentData(data);
    const result = await onSaveDocument?.(documentPath, data, options);
    if (result?.status === 'conflict') {
      setDialogScopeKey(targetScopeKey);
      setConflictMerge({
        documentPath,
        localData: data,
        onResolve: conflictContext?.onResolve,
        remoteDocument: result.remoteDocument,
      });
      setActionErrorMessage(null);
      setActionNoticeMessage(null);
      return false;
    }
    if (result?.status === 'saved' && onResultDocumentSaved) {
      onResultDocumentSaved(result.document);
    } else {
      setResultsStaleState(true);
    }
    setActionErrorMessage(null);
    setActionNoticeMessage(null);
    conflictContext?.onResolve?.();
    return true;
  }

  async function updateDocumentFields(
    documentPath: string,
    operations: ReadonlyArray<FirestoreFieldPatchOperation>,
    options: FirestoreUpdateDocumentFieldsOptions,
    context: {
      readonly localData: Record<string, unknown>;
      readonly onResolve?: (() => void) | undefined;
    },
  ): Promise<boolean> {
    if (!onUpdateDocumentFields) throw new Error('Firestore field patch writes are unavailable.');
    validateFieldPatchOperations(operations);
    const result = await onUpdateDocumentFields?.(documentPath, operations, options);
    if (result?.status === 'conflict') {
      setDialogScopeKey(targetScopeKey);
      setConflictMerge({
        documentPath,
        localData: context.localData,
        onResolve: context.onResolve,
        remoteDocument: result.remoteDocument,
      });
      setActionErrorMessage(null);
      setActionNoticeMessage(null);
      return false;
    }
    if (result?.status === 'document-changed') {
      setActionNoticeMessage(null);
      if (options.staleBehavior === 'confirm' && result.remoteDocument) {
        setDialogScopeKey(targetScopeKey);
        setPendingStaleFieldPatch({
          documentPath,
          localData: context.localData,
          onResolve: context.onResolve,
          operations,
          remoteDocument: result.remoteDocument,
        });
        setActionErrorMessage(null);
      } else {
        setActionErrorMessage('Document changed elsewhere. Refresh before saving this field.');
      }
      return false;
    }
    const syncedSavedDocument = result?.status === 'saved' && Boolean(onResultDocumentSaved);
    if (result?.status === 'saved' && onResultDocumentSaved) {
      onResultDocumentSaved(result.document);
    } else {
      setResultsStaleState(true);
    }
    setActionErrorMessage(null);
    setActionNoticeMessage(
      !syncedSavedDocument && result?.status === 'saved' && result.documentChanged
        ? 'Saved field. Document changed elsewhere; refresh to view the latest data.'
        : null,
    );
    context.onResolve?.();
    return true;
  }

  async function saveField(target: FieldEditTarget, value: unknown): Promise<boolean> {
    const document = documentForTarget(target, rows, selectedDocument);
    if (!document) throw new Error(`Document ${target.documentPath} is not loaded.`);
    validateFirestoreValue(value, target.fieldPath);
    const operation: FirestoreFieldPatchOperation = {
      baseValue: getNestedFieldValue(document.data, target.fieldPath),
      fieldPath: target.fieldPath,
      type: 'set',
      value,
    };
    const localData = setNestedFieldValue(document.data, target.fieldPath, value);
    return await updateDocumentFields(
      target.documentPath,
      [operation],
      await fieldOptionsFor(document),
      {
        localData,
        onResolve: () => setFieldEditor(null),
      },
    );
  }

  async function setFieldNull(target: FieldEditTarget) {
    try {
      await saveField(target, null);
    } catch (caught) {
      setActionErrorMessage(messageFromError(caught, 'Could not set field to null.'));
    }
  }

  async function setFieldValue(target: FieldEditTarget, value: unknown) {
    try {
      await saveField(target, value);
    } catch (caught) {
      setActionErrorMessage(messageFromError(caught, 'Could not save field.'));
    }
  }

  async function deleteField(target: FieldEditTarget) {
    try {
      const document = documentForTarget(target, rows, selectedDocument);
      if (!document) throw new Error(`Document ${target.documentPath} is not loaded.`);
      const operation: FirestoreFieldPatchOperation = {
        baseValue: getNestedFieldValue(document.data, target.fieldPath),
        fieldPath: target.fieldPath,
        type: 'delete',
      };
      const saved = await updateDocumentFields(
        target.documentPath,
        [operation],
        await fieldOptionsFor(document),
        {
          localData: deleteNestedFieldValue(document.data, target.fieldPath),
          onResolve: () => setDeleteFieldTarget(null),
        },
      );
      if (saved) setDeleteFieldTarget(null);
    } catch (caught) {
      setActionErrorMessage(messageFromError(caught, 'Could not delete field.'));
    }
  }

  async function deleteDocument(documentPath: string, options: DeleteDocumentOptions) {
    try {
      await onDeleteDocument?.(documentPath, options);
      if (onResultDocumentDeleted) {
        onResultDocumentDeleted(documentPath);
      } else {
        setResultsStaleState(true);
      }
      setActionErrorMessage(null);
    } catch (caught) {
      setActionErrorMessage(messageFromError(caught, 'Could not delete document.'));
    }
  }

  async function fieldOptionsFor(
    document: FirestoreDocumentResult,
  ): Promise<FirestoreUpdateDocumentFieldsOptions> {
    return {
      ...(document.updateTime ? { lastUpdateTime: document.updateTime } : {}),
      staleBehavior: await loadFieldStaleBehavior(settings),
    };
  }

  function refreshResults() {
    setResultsStaleState(false);
    setActionErrorMessage(null);
    setActionNoticeMessage(null);
    (onRefreshResults ?? onRun)();
  }

  function runQuery() {
    setResultsStaleState(false);
    onRun();
  }

  function setResultsStaleState(stale: boolean) {
    setUncontrolledResultsStale(stale);
    const onChange = onResultsStaleChangeRef.current;
    if (!onChange) return;
    const scopeKey = resultsScopeKeyRef.current;
    if (scopeKey === undefined) {
      onChange(stale);
      return;
    }
    onChange(stale, scopeKey);
  }

  function setResultViewState(nextResultView: FirestoreResultView) {
    setUncontrolledResultView(nextResultView);
    const onChange = onResultViewChangeRef.current;
    if (!onChange) return;
    const scopeKey = resultsScopeKeyRef.current;
    if (scopeKey === undefined) {
      onChange(nextResultView);
      return;
    }
    onChange(nextResultView, scopeKey);
  }

  function openCreateDocument(collectionPath: string) {
    if (!isCollectionPath(collectionPath)) return;
    setDialogScopeKey(targetScopeKey);
    setCreateDocumentState({ collectionPath, collectionPathEditable: false });
  }

  async function saveMergedConflict(data: Record<string, unknown>) {
    if (!conflictMerge?.remoteDocument?.updateTime) {
      throw new Error('Remote update time is unavailable. Refresh the document before saving.');
    }
    const saved = await saveDocument(
      conflictMerge.documentPath,
      data,
      { lastUpdateTime: conflictMerge.remoteDocument.updateTime },
      { onResolve: conflictMerge.onResolve },
    );
    if (saved) setConflictMerge(null);
  }

  function refreshAfterConflict() {
    setConflictMerge(null);
    setEditorDocument(null);
    setFieldEditor(null);
    setDeleteFieldTarget(null);
    setPendingStaleFieldPatch(null);
    refreshResults();
  }

  async function confirmStaleFieldPatch() {
    const lastUpdateTime = pendingStaleFieldPatch?.remoteDocument.updateTime;
    if (!lastUpdateTime) return;
    const pending = pendingStaleFieldPatch;
    setPendingStaleFieldPatch(null);
    try {
      await updateDocumentFields(
        pending.documentPath,
        pending.operations,
        {
          lastUpdateTime,
          staleBehavior: 'confirm',
        },
        {
          localData: pending.localData,
          onResolve: pending.onResolve,
        },
      );
    } catch (caught) {
      setActionErrorMessage(messageFromError(caught, 'Could not save field.'));
    }
  }

  return (
    <div className='h-full min-h-0 p-2'>
      <FirestoreDocumentBrowser
        density={density}
        errorMessage={errorMessage}
        hasMore={hasMore}
        header={
          <QueryBuilder
            draft={draft}
            fieldSuggestions={fieldSuggestions}
            isLoading={isLoading}
            onDraftEdit={onDraftEdit}
            onRun={runQuery}
          />
        }
        isFetchingMore={isFetchingMore}
        isLoading={isLoading}
        actionErrorMessage={actionErrorMessage}
        actionNoticeMessage={actionNoticeMessage}
        inspectorUi={inspectorUi}
        inspectorWidth={inspectorWidth}
        queryPath={resultQueryPath ?? draft.path}
        resultView={effectiveResultView}
        resultsScopeKey={resultsScopeKey}
        resultsStale={effectiveResultsStale}
        rows={rows}
        selectedDocument={selectedDocument}
        selectedDocumentPath={selectedDocumentPath}
        settings={settings}
        onCollectionJob={onStartCollectionJob
          ? (kind, collectionPath) => {
            setDialogScopeKey(targetScopeKey);
            setCollectionJob({ collectionPath, kind });
          }
          : undefined}
        onDeleteDocument={onDeleteDocument
          ? (document) => {
            setDialogScopeKey(targetScopeKey);
            setDeleteDocumentTarget(document);
          }
          : undefined}
        onDeleteField={fieldActionsEnabled
          ? (target) => {
            setDialogScopeKey(targetScopeKey);
            setDeleteFieldTarget(target);
          }
          : undefined}
        onEditDocument={(document) => {
          setDialogScopeKey(targetScopeKey);
          setEditorDocument(document);
        }}
        onEditField={fieldActionsEnabled
          ? (target) => {
            setDialogScopeKey(targetScopeKey);
            const document = documentForTarget(target, rows, selectedDocument);
            setFieldEditor({
              ...target,
              value: document
                ? getNestedFieldValue(document.data, target.fieldPath)
                : target.value,
            });
          }
          : undefined}
        onLoadMore={onLoadMore}
        onLoadSubcollections={onLoadSubcollections}
        onInspectorOverviewCollapsedChange={onInspectorOverviewCollapsedChange}
        onInspectorSectionOpenChange={onInspectorSectionOpenChange}
        onInspectorWidthChange={onInspectorWidthChange}
        onOpenDocumentInNewTab={onOpenDocumentInNewTab}
        onResultViewChange={setResultViewState}
        onResultTreeExpandedIdsChange={onResultTreeExpandedIdsChange}
        onRefreshResults={refreshResults}
        onSettingsError={setActionErrorMessage}
        onCreateDocument={onCreateDocument && onGenerateDocumentId
          ? openCreateDocument
          : undefined}
        onSelectDocument={onSelectDocument}
        onSelectionPreviewExpandedPathsChange={onSelectionPreviewExpandedPathsChange}
        onSetFieldValue={fieldActionsEnabled ? setFieldValue : undefined}
        onSetFieldNull={fieldActionsEnabled ? setFieldNull : undefined}
      />
      <DocumentEditorModal
        document={editorDocument}
        open={dialogScopeIsCurrent && Boolean(editorDocument)}
        onSaveDocument={(documentPath, data) =>
          saveDocument(documentPath, data, saveOptionsFor(editorDocument), {
            onResolve: () => setEditorDocument(null),
          })}
        onOpenChange={(open) => {
          if (!open) setEditorDocument(null);
        }}
      />
      <FieldEditModal
        open={dialogScopeIsCurrent && Boolean(fieldEditor)}
        target={fieldEditor}
        onSaveField={saveField}
        onOpenChange={(open) => {
          if (!open) setFieldEditor(null);
        }}
      />
      <DeleteDocumentDialog
        document={deleteDocumentTarget}
        open={dialogScopeIsCurrent && Boolean(deleteDocumentTarget)}
        onConfirm={deleteDocument}
        onOpenChange={(open) => {
          if (!open) setDeleteDocumentTarget(null);
        }}
      />
      <ConfirmDialog
        confirmLabel='Delete'
        description={deleteFieldTarget
          ? `Delete field ${fieldPathLabel(deleteFieldTarget.fieldPath)}?`
          : 'Delete field?'}
        open={dialogScopeIsCurrent && Boolean(deleteFieldTarget)}
        title='Delete field'
        onConfirm={() => {
          if (deleteFieldTarget) void deleteField(deleteFieldTarget);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteFieldTarget(null);
        }}
      />
      <ConfirmDialog
        confirmLabel='Save field'
        description='The document changed elsewhere, but this field still matches your loaded value. Save this field change anyway?'
        open={dialogScopeIsCurrent && Boolean(pendingStaleFieldPatch)}
        title='Document changed elsewhere'
        onConfirm={() => {
          void confirmStaleFieldPatch();
        }}
        onOpenChange={(open) => {
          if (!open) setPendingStaleFieldPatch(null);
        }}
      />
      <CreateDocumentModal
        collectionPath={createDocumentState?.collectionPath ?? null}
        collectionPathEditable={createDocumentState?.collectionPathEditable}
        hint={createDocumentState?.collectionPathEditable
          ? 'Firestore creates a collection when the first document is written. Enter the collection path and first document data.'
          : null}
        open={dialogScopeIsCurrent && Boolean(createDocumentState)}
        title={createDocumentState?.collectionPathEditable ? 'New collection' : 'New document'}
        onCreateDocument={createDocument}
        onGenerateDocumentId={async (collectionPath) =>
          await Promise.resolve(onGenerateDocumentId?.(collectionPath) ?? '')}
        onOpenChange={(open) => {
          if (!open) setCreateDocumentState(null);
        }}
      />
      {dialogScopeIsCurrent && collectionJob
        ? (
          <CollectionJobDialog
            activeProject={activeProject}
            collectionPath={collectionJob.collectionPath}
            initialKind={collectionJob.kind}
            open
            projects={projects}
            onOpenChange={(open) => {
              if (!open) setCollectionJob(null);
            }}
            onPickExportFile={async (format) =>
              await Promise.resolve(onPickCollectionJobExportFile?.(format) ?? null)}
            onPickImportFile={async () =>
              await Promise.resolve(onPickCollectionJobImportFile?.() ?? null)}
            onStartJob={async (request) => {
              await onStartCollectionJob?.(request);
            }}
          />
        )
        : null}
      {dialogScopeIsCurrent && conflictMerge
        ? (
          <ConflictMergeModal
            documentPath={conflictMerge.documentPath}
            localData={conflictMerge.localData}
            open
            remoteDocument={conflictMerge.remoteDocument}
            onCancel={() => setConflictMerge(null)}
            onRefresh={refreshAfterConflict}
            onSaveMerged={saveMergedConflict}
          />
        )
        : null}
    </div>
  );
}

function saveOptionsFor(
  document: FirestoreDocumentResult | null,
): FirestoreSaveDocumentOptions | undefined {
  return document?.updateTime ? { lastUpdateTime: document.updateTime } : undefined;
}

async function loadFieldStaleBehavior(
  settings: SettingsRepository | undefined,
): Promise<FirestoreFieldStaleBehavior> {
  return normalizeFirestoreWriteSettings((await settings?.load())?.firestoreWrites)
    .fieldStaleBehavior;
}

function validateFieldPatchOperations(
  operations: ReadonlyArray<FirestoreFieldPatchOperation>,
): void {
  if (!operations.length) throw new Error('At least one field operation is required.');
  for (const operation of operations) {
    if (!operation.fieldPath.length) throw new Error('Field path is required.');
    if (operation.type === 'set') validateFirestoreValue(operation.value, operation.fieldPath);
  }
}

function documentForTarget(
  target: FieldEditTarget,
  rows: ReadonlyArray<FirestoreDocumentResult>,
  selectedDocument: FirestoreDocumentResult | null,
): FirestoreDocumentResult | null {
  return findDocumentByPath(rows, target.documentPath)
    ?? (selectedDocument?.path === target.documentPath ? selectedDocument : null);
}
