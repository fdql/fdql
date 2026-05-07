import { describe, expect, it } from 'vitest';
import { FdqlCompileRequestSchema, FdqlRunEventSchema, FdqlRunRequestSchema } from './fdql.ts';

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
          provider: 'fs',
          readContribution: 1,
          rowPath: 'orders/ord_1',
          source: '$orders',
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
});
