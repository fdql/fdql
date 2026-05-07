import { describe, expect, it } from 'vitest';
import type { FdqlSingleReadPlan } from '../types.ts';
import { createStats, stopReasonFor } from './stats.ts';

const plan: FdqlSingleReadPlan = {
  aliases: {},
  kind: 'read',
  localStages: [],
  provider: {
    source: {
      provider: 'mem',
      sourceAlias: '$people',
      sourceType: 'collection',
      target: { collection: 'people' },
    },
  },
  returnStage: { column: 1, items: [], kind: 'return', line: 1, range: sourceRange() },
  rowAlias: 'p',
  settings: {
    allowUnboundedReads: false,
    cache: 'off',
    cacheTtlMs: 86_400_000,
    pageSize: 100,
    readBudget: 1,
    timeoutMs: 10,
  },
};

describe('FDQL executor stats', () => {
  it('creates zeroed stats and stops on budget, cancel, and timeout', () => {
    const stats = createStats(1);

    expect(stats).toMatchObject({ reads: 0, rowsOutput: 0 });
    expect(stopReasonFor(plan, { ...stats, reads: 1 }, 0, { now: () => 0 }, 'afterRow')).toBe(
      'budget',
    );
    expect(stopReasonFor(plan, stats, 0, { signal: { aborted: true } }, 'beforeRow')).toBe(
      'cancelled',
    );
    expect(stopReasonFor(plan, stats, 0, { now: () => 10 }, 'beforeRow')).toBe('timeout');
  });
});

function sourceRange() {
  return { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
}
