import { z } from 'zod';

export const FIRESTORE_SQL_EVENT_CHANNEL = 'firestoreSql.event';

export const FirestoreSqlDiagnosticSchema = z.object({
  code: z.string(),
  column: z.number().optional(),
  line: z.number().optional(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});

export const FirestoreSqlStatsSchema = z.object({
  joinMisses: z.number(),
  perProjectReads: z.record(z.string(), z.number()),
  readBudget: z.number(),
  reads: z.number(),
  rowsOutput: z.number(),
  rowsScanned: z.number(),
  stoppedReason: z.enum(['budget', 'cancelled', 'completed', 'timeout']).optional(),
  writes: z.number(),
});

export const FirestoreSqlRowLineageSchema = z.object({
  baseSource: z.string().optional(),
  joinedSources: z.array(z.string()),
  localSources: z.array(z.string()),
  readContribution: z.number(),
  unionBranch: z.number().optional(),
});

export const FirestoreSqlExecutionDefaultsSchema = z.object({
  pageSize: z.number().int().positive().optional(),
  readBudget: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const FirestoreSqlContextSchema = z.object({
  defaultProjectId: z.string().optional(),
  projectAliases: z.record(z.string(), z.string()).optional(),
});

export const FirestoreSqlCompileRequestSchema = z.object({
  connectionId: z.string(),
  context: FirestoreSqlContextSchema.optional(),
  execution: FirestoreSqlExecutionDefaultsSchema.optional(),
  source: z.string(),
});

export const FirestoreSqlCompileResultSchema = z.object({
  diagnostics: z.array(FirestoreSqlDiagnosticSchema),
  ok: z.boolean(),
  plan: z.unknown().optional(),
  snippet: z.string().optional(),
});

export const FirestoreSqlRunRequestSchema = FirestoreSqlCompileRequestSchema.extend({
  runId: z.string(),
});

export const FirestoreSqlRunResultSchema = z.object({
  cancelled: z.boolean().optional(),
  diagnostics: z.array(FirestoreSqlDiagnosticSchema),
  durationMs: z.number(),
  rows: z.array(z.record(z.string(), z.unknown())),
  stats: FirestoreSqlStatsSchema.nullable(),
});

export const FirestoreSqlRunEventSchema = z.discriminatedUnion('type', [
  z.object({ runId: z.string(), type: z.literal('started') }),
  z.object({ plan: z.unknown(), runId: z.string(), type: z.literal('plan') }),
  z.object({
    diagnostic: FirestoreSqlDiagnosticSchema,
    runId: z.string(),
    type: z.literal('diagnostic'),
  }),
  z.object({
    collectionGroup: z.string().optional(),
    collectionPath: z.string().optional(),
    count: z.number(),
    projectId: z.string(),
    runId: z.string(),
    type: z.literal('read'),
  }),
  z.object({
    lineage: FirestoreSqlRowLineageSchema,
    row: z.record(z.string(), z.unknown()),
    runId: z.string(),
    type: z.literal('row'),
  }),
  z.object({ runId: z.string(), stats: FirestoreSqlStatsSchema, type: z.literal('stats') }),
  z.object({
    result: FirestoreSqlRunResultSchema,
    runId: z.string(),
    type: z.literal('completed'),
  }),
  z.object({
    result: FirestoreSqlRunResultSchema,
    runId: z.string(),
    type: z.literal('cancelled'),
  }),
  z.object({
    diagnostic: FirestoreSqlDiagnosticSchema,
    result: FirestoreSqlRunResultSchema,
    runId: z.string(),
    type: z.literal('failed'),
  }),
]);
