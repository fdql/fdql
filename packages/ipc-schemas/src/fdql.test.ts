import { describe, expect, it } from 'vitest';
import {
  FdqlCompileRequestSchema,
  FdqlRunEventSchema,
  FdqlRunRequestSchema,
  FdqlRunResultSchema,
} from './fdql.ts';

describe('FDQL IPC schemas', () => {
  it('accepts compile and run requests', () => {
    expect(
      FdqlCompileRequestSchema.safeParse({
        connectionId: 'mock',
        defaultProjectId: 'demo',
        execution: { readBudget: 100 },
        source: 'from $drivers as d',
      }).success,
    ).toBe(true);

    expect(
      FdqlRunRequestSchema.safeParse({
        connectionId: 'mock',
        runId: 'run_1',
        source: 'from $drivers as d',
      }).success,
    ).toBe(true);
  });

  it('validates row events and rejects malformed run events', () => {
    expect(
      FdqlRunEventSchema.safeParse({
        lineage: {
          bindings: [{
            binding: 'order',
            sources: [{
              provider: 'fs',
              readContribution: 1,
              rowPath: 'orders/ord_1',
              source: '$orders',
              stage: 'source',
            }],
          }],
          mode: 'compact',
          readContribution: 1,
          sources: [{
            provider: 'fs',
            readContribution: 1,
            rowPath: 'orders/ord_1',
            source: '$orders',
            stage: 'source',
          }],
        },
        row: { id: 'ord_1' },
        runId: 'run_1',
        type: 'row',
      }).success,
    ).toBe(true);

    expect(
      FdqlRunEventSchema.safeParse({
        runId: 'run_1',
        type: 'row',
      }).success,
    ).toBe(false);
  });

  it('accepts diagnostic execution context', () => {
    expect(
      FdqlRunEventSchema.safeParse({
        diagnostic: {
          code: 'FDQL_EXECUTION_FAILED',
          context: {
            provider: 'fs',
            rowAlias: 'driver',
            rowPath: 'events/event_24h',
            source: '$drivers',
            stage: 'lookup',
          },
          message: 'Provider read failed.',
          severity: 'error',
        },
        runId: 'run_1',
        type: 'diagnostic',
      }).success,
    ).toBe(true);
  });

  it('accepts cache clear run results', () => {
    expect(
      FdqlRunResultSchema.safeParse({
        command: {
          clearedEntries: 12,
          kind: 'clearCache',
          message: 'Cleared 12 cache entries.',
        },
        diagnostics: [],
        durationMs: 20,
        rows: [],
        stats: null,
      }).success,
    ).toBe(true);
  });

  it('accepts run results with timed stage stats', () => {
    expect(
      FdqlRunResultSchema.safeParse({
        diagnostics: [],
        durationMs: 20,
        rows: [{ id: 'drv_1' }],
        stats: {
          aggregateReads: 0,
          aggregateSourceRows: 0,
          cacheBytes: 0,
          cacheEvictions: 0,
          cacheHits: 0,
          cacheMisses: 0,
          cacheWrites: 0,
          lookupReads: 0,
          providerAggregateReads: {},
          providerReads: { fs: 1 },
          readBudget: 5000,
          reads: 1,
          rowsOutput: 1,
          rowsScanned: 1,
          stageStats: [{
            aggregateReads: 0,
            droppedRows: 0,
            durationMs: 12,
            endedAtMs: 112,
            inputRows: 0,
            outputRows: 1,
            provider: 'fs',
            reads: 1,
            source: '$drivers',
            stage: 'source',
            startedAtMs: 100,
          }],
          stoppedReason: 'completed',
          unionBranches: 0,
        },
      }).success,
    ).toBe(true);
  });
});
