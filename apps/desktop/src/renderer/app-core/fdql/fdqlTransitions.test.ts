import type { FdqlRunEvent, FdqlRunResult } from '@firebase-desk/repo-contracts';
import { describe, expect, it } from 'vitest';
import { createInitialFdqlState } from './fdqlState.ts';
import {
  fdqlEventReceived,
  fdqlRunFinished,
  fdqlRunRequested,
  fdqlRunStarted,
  fdqlTabDuplicated,
  fdqlTabRuntimeCleared,
} from './fdqlTransitions.ts';

describe('fdqlTransitions', () => {
  it('clears stale output when a run is requested', () => {
    const state = fdqlRunRequested(
      {
        ...createInitialFdqlState(),
        compileResults: { 'tab-1': { diagnostics: [], ok: true } },
        results: { 'tab-1': result([{ id: 'stale' }]) },
      },
      'tab-1',
    );

    expect(state.compileResults['tab-1']).toBeUndefined();
    expect(state.results['tab-1']).toBeUndefined();
  });

  it('replaces streamed rows with the final run result', () => {
    const running = fdqlRunStarted(createInitialFdqlState(), {
      connectionId: 'emu',
      runId: 'run-1',
      source: 'from $orders as o',
      startedAt: 100,
      tabId: 'tab-1',
    });
    const streamed = fdqlEventReceived(running, {
      event: rowEvent('run-1', { id: 'streamed' }),
      now: 110,
      tabIsCurrent: () => true,
    });

    const state = fdqlRunFinished(streamed, 'tab-1', result([{ id: 'final' }]));

    expect(state.results['tab-1']?.rows).toEqual([{ id: 'final' }]);
  });

  it('clears runtime state without removing tab source', () => {
    const running = fdqlRunStarted(
      {
        ...createInitialFdqlState(),
        compileResults: { 'tab-1': { diagnostics: [], ok: true } },
        results: { 'tab-1': result([{ id: 'stale' }]) },
        sources: { 'tab-1': 'from $orders as o\nreturn o' },
      },
      {
        connectionId: 'emu',
        runId: 'run-1',
        source: 'from $orders as o',
        startedAt: 100,
        tabId: 'tab-1',
      },
    );

    const state = fdqlTabRuntimeCleared(running, 'tab-1');

    expect(state.sources['tab-1']).toBe('from $orders as o\nreturn o');
    expect(state.activeRuns['tab-1']).toBeUndefined();
    expect(state.compileResults['tab-1']).toBeUndefined();
    expect(state.results['tab-1']).toBeUndefined();
    expect(state.runIds['tab-1']).toBeUndefined();
  });

  it('duplicates tab source without copying runtime state', () => {
    const state = fdqlTabDuplicated(
      {
        ...createInitialFdqlState(),
        results: { 'tab-1': result([{ id: 'stale' }]) },
        sources: { 'tab-1': 'from $orders as o\nreturn o' },
      },
      'tab-1',
      'tab-2',
    );

    expect(state.sources['tab-2']).toBe('from $orders as o\nreturn o');
    expect(state.results['tab-2']).toBeUndefined();
  });
});

function rowEvent(runId: string, row: Record<string, unknown>): FdqlRunEvent {
  return {
    lineage: {
      provider: 'fs',
      readContribution: 1,
      rowPath: 'orders/ord_1',
      source: '$orders',
    },
    row,
    runId,
    type: 'row',
  };
}

function result(rows: readonly Record<string, unknown>[]): FdqlRunResult {
  return {
    diagnostics: [],
    durationMs: 1,
    rows,
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
      providerReads: { 'fs:emu': rows.length },
      readBudget: 5000,
      reads: rows.length,
      rowsOutput: rows.length,
      rowsScanned: rows.length,
      stoppedReason: 'completed',
      unionBranches: 0,
    },
  };
}
