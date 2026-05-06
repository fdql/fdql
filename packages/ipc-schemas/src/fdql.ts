import { z } from 'zod';

export const FDQL_EVENT_CHANNEL = 'fdql.event';

export const FdqlDiagnosticSchema = z.object({
  code: z.string(),
  column: z.number().optional(),
  line: z.number().optional(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});

export const FdqlStatsSchema = z.object({
  aggregateSourceRows: z.number(),
  cacheHits: z.number(),
  cacheMisses: z.number(),
  lookupReads: z.number(),
  perProjectReads: z.record(z.string(), z.number()),
  readBudget: z.number(),
  reads: z.number(),
  rowsOutput: z.number(),
  rowsScanned: z.number(),
  stoppedReason: z.enum(['budget', 'cancelled', 'completed', 'timeout']).optional(),
  unionBranches: z.number(),
});

export const FdqlRowLineageSchema = z.object({
  documentPath: z.string(),
  readContribution: z.number(),
  source: z.string(),
});

export const FdqlExecutionDefaultsSchema = z.object({
  allowUnboundedReads: z.boolean().optional(),
  cache: z.enum(['off', 'run', 'session']).optional(),
  pageSize: z.number().int().positive().optional(),
  readBudget: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const FdqlCompileRequestSchema = z.object({
  connectionId: z.string(),
  defaultProjectId: z.string().optional(),
  execution: FdqlExecutionDefaultsSchema.optional(),
  source: z.string(),
});

export const FdqlCompileResultSchema = z.object({
  diagnostics: z.array(FdqlDiagnosticSchema),
  ok: z.boolean(),
});

export const FdqlRunRequestSchema = FdqlCompileRequestSchema.extend({
  runId: z.string(),
});

export const FdqlRunResultSchema = z.object({
  cancelled: z.boolean().optional(),
  diagnostics: z.array(FdqlDiagnosticSchema),
  durationMs: z.number(),
  rows: z.array(z.record(z.string(), z.unknown())),
  stats: FdqlStatsSchema.nullable(),
});

export const FdqlRunEventSchema = z.discriminatedUnion('type', [
  z.object({ runId: z.string(), type: z.literal('started') }),
  z.object({
    diagnostic: FdqlDiagnosticSchema,
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
    lineage: FdqlRowLineageSchema,
    row: z.record(z.string(), z.unknown()),
    runId: z.string(),
    type: z.literal('row'),
  }),
  z.object({ runId: z.string(), stats: FdqlStatsSchema, type: z.literal('stats') }),
  z.object({
    result: FdqlRunResultSchema,
    runId: z.string(),
    type: z.literal('completed'),
  }),
  z.object({
    result: FdqlRunResultSchema,
    runId: z.string(),
    type: z.literal('cancelled'),
  }),
  z.object({
    diagnostic: FdqlDiagnosticSchema,
    result: FdqlRunResultSchema,
    runId: z.string(),
    type: z.literal('failed'),
  }),
]);
