import type { DensityName } from '@firebase-desk/design-tokens';
import {
  AuthUsersSurface,
  type DeleteDocumentOptions,
  type FirestoreCollectionJobDialogRequest,
  type FirestoreCreateDocumentRequest,
  FirestoreQuerySurface,
  type FirestoreResultView,
  FirestoreSqlSurface,
  JsQuerySurface,
} from '@firebase-desk/product-ui';
import type {
  AuthUser,
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreFieldPatchOperation,
  FirestoreQueryDraft,
  FirestoreSaveDocumentOptions,
  FirestoreSaveDocumentResult,
  FirestoreSqlCompileResult,
  FirestoreSqlContext,
  FirestoreSqlRunResult,
  FirestoreUpdateDocumentFieldsOptions,
  FirestoreUpdateDocumentFieldsResult,
  ProjectSummary,
  ScriptRunResult,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import type {
  FirestoreCollectionJobRequest,
  FirestoreExportFormat,
} from '@firebase-desk/repo-contracts/jobs';
import type { WorkspaceTab } from './stores/tabsStore.ts';

export interface WorkspaceTabViewProps {
  readonly activeTab: WorkspaceTab;
  readonly auth: AuthTabSurfaceModel;
  readonly density: DensityName;
  readonly firestore: FirestoreTabSurfaceModel;
  readonly script: ScriptTabSurfaceModel;
  readonly sql: SqlTabSurfaceModel;
}

export interface AuthTabSurfaceModel {
  readonly errorMessage: string | null;
  readonly filter: string;
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly isLoading: boolean;
  readonly onFilterChange: (value: string) => void;
  readonly onLoadMore: () => void;
  readonly onSaveCustomClaims: (
    uid: string,
    claims: Record<string, unknown>,
  ) => Promise<void> | void;
  readonly onSelectUser: (uid: string) => void;
  readonly selectedUser: AuthUser | null;
  readonly selectedUserId: string | null;
  readonly users: ReadonlyArray<AuthUser>;
}

export interface FirestoreTabSurfaceModel {
  readonly createDocumentRequest: FirestoreCreateDocumentRequest | null;
  readonly draft: FirestoreQueryDraft;
  readonly activeProject: ProjectSummary | null;
  readonly collectionJobRequest: FirestoreCollectionJobDialogRequest | null;
  readonly errorMessage: string | null;
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly isLoading: boolean;
  readonly onCreateDocument: (
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ) => Promise<void> | void;
  readonly onCreateDocumentRequestHandled: (requestId: number) => void;
  readonly onCollectionJobRequestHandled: (requestId: number) => void;
  readonly onDeleteDocument: (
    documentPath: string,
    options: DeleteDocumentOptions,
  ) => void;
  readonly onDraftChange: (draft: FirestoreQueryDraft) => void;
  readonly onGenerateDocumentId: (collectionPath: string) => Promise<string> | string;
  readonly onPickCollectionJobExportFile: (
    format: FirestoreExportFormat,
  ) => Promise<string | null> | string | null;
  readonly onPickCollectionJobImportFile: () => Promise<string | null> | string | null;
  readonly onLoadMore: () => void;
  readonly onLoadSubcollections: (
    documentPath: string,
  ) => Promise<ReadonlyArray<FirestoreCollectionNode>>;
  readonly onOpenDocumentInNewTab: (documentPath: string) => void;
  readonly onReset: () => void;
  readonly onRefreshResults: () => void;
  readonly onResultViewChange: (resultView: FirestoreResultView, scopeKey?: string) => void;
  readonly onResultsStaleChange: (stale: boolean, scopeKey?: string) => void;
  readonly onRunQuery: () => void;
  readonly onSaveDocument: (
    documentPath: string,
    data: Record<string, unknown>,
    options?: FirestoreSaveDocumentOptions,
  ) => Promise<FirestoreSaveDocumentResult | void> | FirestoreSaveDocumentResult | void;
  readonly onUpdateDocumentFields: (
    documentPath: string,
    operations: ReadonlyArray<FirestoreFieldPatchOperation>,
    options: FirestoreUpdateDocumentFieldsOptions,
  ) =>
    | Promise<FirestoreUpdateDocumentFieldsResult | void>
    | FirestoreUpdateDocumentFieldsResult
    | void;
  readonly onSelectDocument: (documentPath: string) => void;
  readonly onStartCollectionJob: (request: FirestoreCollectionJobRequest) => Promise<void> | void;
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly resultView: FirestoreResultView;
  readonly resultsStale: boolean;
  readonly rows: ReadonlyArray<FirestoreDocumentResult>;
  readonly selectedDocument: FirestoreDocumentResult | null;
  readonly selectedDocumentPath: string | null;
  readonly settings: SettingsRepository;
}

export interface ScriptTabSurfaceModel {
  readonly isRunning: boolean;
  readonly onCancel: () => void;
  readonly onRun: () => void;
  readonly onSourceChange: (source: string) => void;
  readonly result: ScriptRunResult | undefined;
  readonly runId: string | null;
  readonly runStartedAt: number | null;
  readonly settings: SettingsRepository;
  readonly source: string;
}

export interface SqlTabSurfaceModel {
  readonly compileResult: FirestoreSqlCompileResult | undefined;
  readonly context: FirestoreSqlContext;
  readonly isRunning: boolean;
  readonly onCancel: () => void;
  readonly onCompile: () => void;
  readonly onContextChange: (context: FirestoreSqlContext) => void;
  readonly onRun: () => void;
  readonly onSourceChange: (source: string) => void;
  readonly result: FirestoreSqlRunResult | undefined;
  readonly runId: string | null;
  readonly runStartedAt: number | null;
  readonly source: string;
}

export function WorkspaceTabView(props: WorkspaceTabViewProps) {
  if (props.activeTab.kind === 'auth-users') {
    return (
      <AuthUsersSurface
        density={props.density}
        errorMessage={props.auth.errorMessage}
        filterValue={props.auth.filter}
        hasMore={props.auth.hasMore}
        isFetchingMore={props.auth.isFetchingMore}
        isLoading={props.auth.isLoading}
        selectedUser={props.auth.selectedUser}
        selectedUserId={props.auth.selectedUserId}
        users={props.auth.users}
        onFilterChange={props.auth.onFilterChange}
        onLoadMore={props.auth.onLoadMore}
        onSaveCustomClaims={props.auth.onSaveCustomClaims}
        onSelectUser={props.auth.onSelectUser}
      />
    );
  }
  if (props.activeTab.kind === 'js-query') {
    return (
      <JsQuerySurface
        isRunning={props.script.isRunning}
        result={props.script.result ?? null}
        runId={props.script.runId}
        runStartedAt={props.script.runStartedAt}
        settings={props.script.settings}
        source={props.script.source}
        onCancel={props.script.onCancel}
        onRun={props.script.onRun}
        onSourceChange={props.script.onSourceChange}
      />
    );
  }
  if (props.activeTab.kind === 'firestore-sql') {
    return (
      <FirestoreSqlSurface
        compileResult={props.sql.compileResult ?? null}
        context={props.sql.context}
        isRunning={props.sql.isRunning}
        result={props.sql.result ?? null}
        source={props.sql.source}
        onCancel={props.sql.onCancel}
        onCompile={props.sql.onCompile}
        onContextChange={props.sql.onContextChange}
        onRun={props.sql.onRun}
        onSourceChange={props.sql.onSourceChange}
      />
    );
  }
  return (
    <FirestoreQuerySurface
      key={props.activeTab.id}
      activeProject={props.firestore.activeProject}
      collectionJobRequest={props.firestore.collectionJobRequest}
      createDocumentRequest={props.firestore.createDocumentRequest}
      draft={props.firestore.draft}
      density={props.density}
      errorMessage={props.firestore.errorMessage}
      hasMore={props.firestore.hasMore}
      isFetchingMore={props.firestore.isFetchingMore}
      isLoading={props.firestore.isLoading}
      rows={props.firestore.rows}
      resultView={props.firestore.resultView}
      resultsScopeKey={props.activeTab.id}
      resultsStale={props.firestore.resultsStale}
      selectedDocument={props.firestore.selectedDocument}
      selectedDocumentPath={props.firestore.selectedDocumentPath}
      settings={props.firestore.settings}
      projects={props.firestore.projects}
      onCreateDocument={props.firestore.onCreateDocument}
      onCollectionJobRequestHandled={props.firestore.onCollectionJobRequestHandled}
      onCreateDocumentRequestHandled={props.firestore.onCreateDocumentRequestHandled}
      onDraftChange={props.firestore.onDraftChange}
      onDeleteDocument={props.firestore.onDeleteDocument}
      onGenerateDocumentId={props.firestore.onGenerateDocumentId}
      onPickCollectionJobExportFile={props.firestore.onPickCollectionJobExportFile}
      onPickCollectionJobImportFile={props.firestore.onPickCollectionJobImportFile}
      onLoadMore={props.firestore.onLoadMore}
      onLoadSubcollections={props.firestore.onLoadSubcollections}
      onOpenDocumentInNewTab={props.firestore.onOpenDocumentInNewTab}
      onReset={props.firestore.onReset}
      onRefreshResults={props.firestore.onRefreshResults}
      onResultViewChange={props.firestore.onResultViewChange}
      onResultsStaleChange={props.firestore.onResultsStaleChange}
      onRun={props.firestore.onRunQuery}
      onSaveDocument={props.firestore.onSaveDocument}
      onUpdateDocumentFields={props.firestore.onUpdateDocumentFields}
      onSelectDocument={props.firestore.onSelectDocument}
      onStartCollectionJob={props.firestore.onStartCollectionJob}
    />
  );
}
