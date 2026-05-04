import {
  BACKGROUND_JOB_STATUSES,
  FIRESTORE_EXPORT_FORMATS,
  FIRESTORE_JOB_COLLISION_POLICIES,
  FIRESTORE_JSONL_EXPORT_ENCODINGS,
} from '@firebase-desk/repo-contracts/jobs';
import { z } from 'zod';
import { CollectionPathSchema } from './firestore.ts';

export const BackgroundJobStatusSchema = z.enum(BACKGROUND_JOB_STATUSES);
export const FirestoreJobCollisionPolicySchema = z.enum(FIRESTORE_JOB_COLLISION_POLICIES);
export const FirestoreExportFormatSchema = z.enum(FIRESTORE_EXPORT_FORMATS);
export const FirestoreJsonlExportEncodingSchema = z.enum(FIRESTORE_JSONL_EXPORT_ENCODINGS);

export const BackgroundJobProgressSchema = z.object({
  currentPath: z.string().optional(),
  deleted: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional(),
  written: z.number().int().nonnegative(),
});

const JobBaseSchema = z.object({
  includeSubcollections: z.boolean(),
});

export const FirestoreCollectionJobRequestSchema = z.discriminatedUnion('type', [
  JobBaseSchema.extend({
    collisionPolicy: FirestoreJobCollisionPolicySchema,
    sourceCollectionPath: CollectionPathSchema,
    sourceConnectionId: z.string().min(1),
    targetCollectionPath: CollectionPathSchema,
    targetConnectionId: z.string().min(1),
    type: z.literal('firestore.copyCollection'),
  }),
  JobBaseSchema.extend({
    collectionPath: CollectionPathSchema,
    connectionId: z.string().min(1),
    collisionPolicy: FirestoreJobCollisionPolicySchema,
    targetCollectionPath: CollectionPathSchema,
    type: z.literal('firestore.duplicateCollection'),
  }),
  JobBaseSchema.extend({
    collectionPath: CollectionPathSchema,
    connectionId: z.string().min(1),
    includeSubcollections: z.boolean(),
    type: z.literal('firestore.deleteCollection'),
  }),
  JobBaseSchema.extend({
    collectionPath: CollectionPathSchema,
    connectionId: z.string().min(1),
    encoding: FirestoreJsonlExportEncodingSchema.optional(),
    filePath: z.string().min(1),
    format: FirestoreExportFormatSchema,
    type: z.literal('firestore.exportCollection'),
  }),
  z.object({
    collisionPolicy: FirestoreJobCollisionPolicySchema,
    connectionId: z.string().min(1),
    filePath: z.string().min(1),
    targetCollectionPath: CollectionPathSchema,
    type: z.literal('firestore.importCollection'),
  }),
]);

export const BackgroundJobSchema = z.object({
  acknowledgedAt: z.string().optional(),
  cancelRequested: z.boolean().optional(),
  createdAt: z.string(),
  error: z.object({
    message: z.string(),
    name: z.string().optional(),
  }).optional(),
  finishedAt: z.string().optional(),
  id: z.string(),
  progress: BackgroundJobProgressSchema,
  request: FirestoreCollectionJobRequestSchema,
  result: z.object({
    filePath: z.string().optional(),
  }).optional(),
  startedAt: z.string().optional(),
  status: BackgroundJobStatusSchema,
  summary: z.string().optional(),
  title: z.string(),
  type: z.enum([
    'firestore.copyCollection',
    'firestore.deleteCollection',
    'firestore.duplicateCollection',
    'firestore.exportCollection',
    'firestore.importCollection',
  ]),
  updatedAt: z.string(),
});

export const BackgroundJobEventSchema = z.discriminatedUnion('type', [
  z.object({ job: BackgroundJobSchema, type: z.literal('job-added') }),
  z.object({ job: BackgroundJobSchema, type: z.literal('job-updated') }),
  z.object({ id: z.string(), type: z.literal('job-removed') }),
]);

export const BackgroundJobListRequestSchema = z.object({
  limit: z.number().int().positive().optional(),
  status: z.union([BackgroundJobStatusSchema, z.literal('all')]).optional(),
});

export const BackgroundJobAcknowledgeIssuesRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const BackgroundJobPickExportFileRequestSchema = z.object({
  format: FirestoreExportFormatSchema,
});

export const BackgroundJobPickFileResultSchema = z.object({
  canceled: z.boolean(),
  filePath: z.string().optional(),
});
