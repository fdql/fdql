export const BACKGROUND_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number];

export const BACKGROUND_JOB_TYPES = [
  'firestore.copyCollection',
  'firestore.deleteCollection',
  'firestore.duplicateCollection',
  'firestore.exportCollection',
  'firestore.importCollection',
] as const;

export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];

export const FIRESTORE_JOB_COLLISION_POLICIES = ['skip', 'overwrite', 'fail'] as const;
export type FirestoreJobCollisionPolicy = (typeof FIRESTORE_JOB_COLLISION_POLICIES)[number];

export const FIRESTORE_EXPORT_FORMATS = ['jsonl', 'csv'] as const;
export type FirestoreExportFormat = (typeof FIRESTORE_EXPORT_FORMATS)[number];

export const FIRESTORE_JSONL_EXPORT_ENCODINGS = ['encoded', 'plain'] as const;
export type FirestoreJsonlExportEncoding = (typeof FIRESTORE_JSONL_EXPORT_ENCODINGS)[number];

export interface BackgroundJobProgress {
  readonly currentPath?: string | undefined;
  readonly deleted: number;
  readonly failed: number;
  readonly read: number;
  readonly skipped: number;
  readonly total?: number | undefined;
  readonly written: number;
}

export const EMPTY_BACKGROUND_JOB_PROGRESS: BackgroundJobProgress = {
  deleted: 0,
  failed: 0,
  read: 0,
  skipped: 0,
  written: 0,
};

export interface BackgroundJobError {
  readonly message: string;
  readonly name?: string | undefined;
}

export interface BackgroundJobResult {
  readonly filePath?: string | undefined;
}

export type FirestoreCollectionJobRequest =
  | FirestoreCopyCollectionJobRequest
  | FirestoreDeleteCollectionJobRequest
  | FirestoreDuplicateCollectionJobRequest
  | FirestoreExportCollectionJobRequest
  | FirestoreImportCollectionJobRequest;

export interface FirestoreCopyCollectionJobRequest {
  readonly collisionPolicy: FirestoreJobCollisionPolicy;
  readonly includeSubcollections: boolean;
  readonly sourceCollectionPath: string;
  readonly sourceConnectionId: string;
  readonly targetCollectionPath: string;
  readonly targetConnectionId: string;
  readonly type: 'firestore.copyCollection';
}

export interface FirestoreDuplicateCollectionJobRequest {
  readonly collisionPolicy: FirestoreJobCollisionPolicy;
  readonly collectionPath: string;
  readonly connectionId: string;
  readonly includeSubcollections: boolean;
  readonly targetCollectionPath: string;
  readonly type: 'firestore.duplicateCollection';
}

export interface FirestoreDeleteCollectionJobRequest {
  readonly collectionPath: string;
  readonly connectionId: string;
  readonly includeSubcollections: boolean;
  readonly type: 'firestore.deleteCollection';
}

export interface FirestoreExportCollectionJobRequest {
  readonly collectionPath: string;
  readonly connectionId: string;
  readonly encoding?: FirestoreJsonlExportEncoding | undefined;
  readonly filePath: string;
  readonly format: FirestoreExportFormat;
  readonly includeSubcollections: boolean;
  readonly type: 'firestore.exportCollection';
}

export interface FirestoreImportCollectionJobRequest {
  readonly collisionPolicy: FirestoreJobCollisionPolicy;
  readonly connectionId: string;
  readonly filePath: string;
  readonly targetCollectionPath: string;
  readonly type: 'firestore.importCollection';
}

export interface BackgroundJob {
  readonly acknowledgedAt?: string | undefined;
  readonly cancelRequested?: boolean | undefined;
  readonly createdAt: string;
  readonly error?: BackgroundJobError | undefined;
  readonly finishedAt?: string | undefined;
  readonly id: string;
  readonly progress: BackgroundJobProgress;
  readonly request: FirestoreCollectionJobRequest;
  readonly result?: BackgroundJobResult | undefined;
  readonly startedAt?: string | undefined;
  readonly status: BackgroundJobStatus;
  readonly summary?: string | undefined;
  readonly title: string;
  readonly type: BackgroundJobType;
  readonly updatedAt: string;
}

export type BackgroundJobEvent =
  | { readonly job: BackgroundJob; readonly type: 'job-added'; }
  | { readonly job: BackgroundJob; readonly type: 'job-updated'; }
  | { readonly id: string; readonly type: 'job-removed'; };

export interface BackgroundJobListRequest {
  readonly limit?: number | undefined;
  readonly status?: BackgroundJobStatus | 'all' | undefined;
}

export interface BackgroundJobPickFileResult {
  readonly canceled: boolean;
  readonly filePath?: string | undefined;
}

export interface BackgroundJobRepository {
  acknowledgeIssues(ids: ReadonlyArray<string>): Promise<void>;
  cancel(id: string): Promise<void>;
  clearCompleted(): Promise<void>;
  list(request?: BackgroundJobListRequest): Promise<ReadonlyArray<BackgroundJob>>;
  pickExportFile(format: FirestoreExportFormat): Promise<BackgroundJobPickFileResult>;
  pickImportFile(): Promise<BackgroundJobPickFileResult>;
  start(request: FirestoreCollectionJobRequest): Promise<BackgroundJob>;
  subscribe(listener: (event: BackgroundJobEvent) => void): () => void;
}
