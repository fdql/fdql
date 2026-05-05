import { z } from 'zod';
import {
  ActivityLogAppendInputSchema,
  ActivityLogEntrySchema,
  ActivityLogExportResultSchema,
  ActivityLogListRequestSchema,
} from './activity.ts';
import {
  AuthUserSchema,
  AuthUsersPageSchema,
  ListUsersRequestSchema,
  SearchUsersRequestSchema,
  SetCustomClaimsRequestSchema,
} from './auth.ts';
import {
  FirestoreSqlCompileRequestSchema,
  FirestoreSqlCompileResultSchema,
  FirestoreSqlRunRequestSchema,
  FirestoreSqlRunResultSchema,
} from './firestore-sql.ts';
import {
  CreateDocumentRequestSchema,
  DeleteDocumentRequestSchema,
  FirestoreCollectionNodeSchema,
  FirestoreDocumentResultSchema,
  FirestoreDocumentsPageSchema,
  FirestoreGeneratedDocumentIdSchema,
  FirestoreResultsPageSchema,
  FirestoreSaveDocumentResultSchema,
  FirestoreUpdateDocumentFieldsResultSchema,
  GenerateDocumentIdRequestSchema,
  GetDocumentRequestSchema,
  ListDocumentsRequestSchema,
  ListSubcollectionsRequestSchema,
  RunQueryRequestSchema,
  SaveDocumentRequestSchema,
  UpdateDocumentFieldsRequestSchema,
} from './firestore.ts';
import { HealthCheckRequestSchema, HealthCheckResponseSchema } from './health.ts';
import {
  BackgroundJobAcknowledgeIssuesRequestSchema,
  BackgroundJobListRequestSchema,
  BackgroundJobPickExportFileRequestSchema,
  BackgroundJobPickFileResultSchema,
  BackgroundJobSchema,
  FirestoreCollectionJobRequestSchema,
} from './jobs.ts';
import {
  PickServiceAccountFileResultSchema,
  ProjectAddInputSchema,
  ProjectSummarySchema,
  ProjectUpdatePatchSchema,
  ServiceAccountValidationResultSchema,
} from './projects.ts';
import { ScriptRunRequestSchema, ScriptRunResultSchema } from './script-runner.ts';
import {
  DataModeSchema,
  HotkeyOverridesSchema,
  SettingsPatchSchema,
  SettingsSnapshotSchema,
} from './settings.ts';
import {
  OpenExternalUrlRequestSchema,
  UpdateCheckRequestSchema,
  UpdateCheckResultSchema,
} from './updates.ts';

/**
 * Central registry of every IPC channel. Keys are channel names; values are
 * the request/response schemas. Adding a method here is the single source of
 * truth for both the preload client and the main handler.
 */
export const IPC_CHANNELS = {
  'health.check': {
    request: HealthCheckRequestSchema,
    response: HealthCheckResponseSchema,
  },
  'app.config': {
    request: z.object({}),
    response: z.object({
      appVersion: z.string(),
      dataDirectory: z.string(),
      dataMode: DataModeSchema,
    }),
  },
  'app.openDataDirectory': {
    request: z.object({}),
    response: z.void(),
  },
  'app.checkForUpdates': {
    request: UpdateCheckRequestSchema,
    response: UpdateCheckResultSchema,
  },
  'app.openExternalUrl': {
    request: OpenExternalUrlRequestSchema,
    response: z.void(),
  },
  'activity.append': {
    request: ActivityLogAppendInputSchema,
    response: ActivityLogEntrySchema,
  },
  'activity.clear': {
    request: z.object({}),
    response: z.void(),
  },
  'activity.export': {
    request: ActivityLogListRequestSchema,
    response: ActivityLogExportResultSchema,
  },
  'activity.list': {
    request: ActivityLogListRequestSchema,
    response: z.array(ActivityLogEntrySchema),
  },
  'jobs.cancel': {
    request: z.object({ id: z.string() }),
    response: z.void(),
  },
  'jobs.acknowledgeIssues': {
    request: BackgroundJobAcknowledgeIssuesRequestSchema,
    response: z.void(),
  },
  'jobs.clearCompleted': {
    request: z.object({}),
    response: z.void(),
  },
  'jobs.list': {
    request: BackgroundJobListRequestSchema,
    response: z.array(BackgroundJobSchema),
  },
  'jobs.pickExportFile': {
    request: BackgroundJobPickExportFileRequestSchema,
    response: BackgroundJobPickFileResultSchema,
  },
  'jobs.pickImportFile': {
    request: z.object({}),
    response: BackgroundJobPickFileResultSchema,
  },
  'jobs.start': {
    request: FirestoreCollectionJobRequestSchema,
    response: BackgroundJobSchema,
  },
  'projects.list': {
    request: z.object({}),
    response: z.array(ProjectSummarySchema),
  },
  'projects.get': {
    request: z.object({ id: z.string() }),
    response: ProjectSummarySchema.nullable(),
  },
  'projects.add': {
    request: ProjectAddInputSchema,
    response: ProjectSummarySchema,
  },
  'projects.update': {
    request: z.object({ id: z.string(), patch: ProjectUpdatePatchSchema }),
    response: ProjectSummarySchema,
  },
  'projects.remove': {
    request: z.object({ id: z.string() }),
    response: z.void(),
  },
  'projects.validateServiceAccount': {
    request: z.object({ json: z.string() }),
    response: ServiceAccountValidationResultSchema,
  },
  'projects.pickServiceAccountFile': {
    request: z.object({}),
    response: PickServiceAccountFileResultSchema,
  },
  'firestore.listRootCollections': {
    request: z.object({ connectionId: z.string() }),
    response: z.array(FirestoreCollectionNodeSchema),
  },
  'firestore.listDocuments': {
    request: ListDocumentsRequestSchema,
    response: FirestoreDocumentsPageSchema,
  },
  'firestore.listSubcollections': {
    request: ListSubcollectionsRequestSchema,
    response: z.array(FirestoreCollectionNodeSchema),
  },
  'firestore.runQuery': {
    request: RunQueryRequestSchema,
    response: FirestoreResultsPageSchema,
  },
  'firestore.getDocument': {
    request: GetDocumentRequestSchema,
    response: FirestoreDocumentResultSchema.nullable(),
  },
  'firestore.generateDocumentId': {
    request: GenerateDocumentIdRequestSchema,
    response: FirestoreGeneratedDocumentIdSchema,
  },
  'firestore.createDocument': {
    request: CreateDocumentRequestSchema,
    response: FirestoreDocumentResultSchema,
  },
  'firestore.saveDocument': {
    request: SaveDocumentRequestSchema,
    response: FirestoreSaveDocumentResultSchema,
  },
  'firestore.updateDocumentFields': {
    request: UpdateDocumentFieldsRequestSchema,
    response: FirestoreUpdateDocumentFieldsResultSchema,
  },
  'firestore.deleteDocument': {
    request: DeleteDocumentRequestSchema,
    response: z.void(),
  },
  'firestoreSql.compile': {
    request: FirestoreSqlCompileRequestSchema,
    response: FirestoreSqlCompileResultSchema,
  },
  'firestoreSql.run': {
    request: FirestoreSqlRunRequestSchema,
    response: FirestoreSqlRunResultSchema,
  },
  'firestoreSql.cancel': {
    request: z.object({ runId: z.string() }),
    response: z.void(),
  },
  'scriptRunner.run': {
    request: ScriptRunRequestSchema,
    response: ScriptRunResultSchema,
  },
  'scriptRunner.cancel': {
    request: z.object({ runId: z.string() }),
    response: z.void(),
  },
  'auth.listUsers': {
    request: ListUsersRequestSchema,
    response: AuthUsersPageSchema,
  },
  'auth.getUser': {
    request: z.object({ projectId: z.string(), uid: z.string() }),
    response: AuthUserSchema.nullable(),
  },
  'auth.searchUsers': {
    request: SearchUsersRequestSchema,
    response: z.array(AuthUserSchema),
  },
  'auth.setCustomClaims': {
    request: SetCustomClaimsRequestSchema,
    response: AuthUserSchema,
  },
  'settings.load': {
    request: z.object({}),
    response: SettingsSnapshotSchema,
  },
  'settings.save': {
    request: SettingsPatchSchema,
    response: SettingsSnapshotSchema,
  },
  'settings.getHotkeyOverrides': {
    request: z.object({}),
    response: HotkeyOverridesSchema,
  },
  'settings.setHotkeyOverrides': {
    request: HotkeyOverridesSchema,
    response: z.void(),
  },
} as const;

export type IpcChannel = keyof typeof IPC_CHANNELS;

export type IpcRequest<C extends IpcChannel> = z.infer<(typeof IPC_CHANNELS)[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.infer<(typeof IPC_CHANNELS)[C]['response']>;

export const JOB_EVENT_CHANNEL = 'jobs.event';
