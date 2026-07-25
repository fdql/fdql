import { describe, expect, it } from 'vitest';
import type { FdqlProviderRow, FdqlStageStats } from '../types.ts';
import { createLineageRecorder } from './lineage.ts';
import type { RowRecord } from './types.ts';

describe('FDQL executor lineage recorder', () => {
  it('omits row lineage in off mode while keeping stage stats', () => {
    const stageStats: FdqlStageStats[] = [];
    const recorder = createLineageRecorder('off', stageStats);
    const row = {};

    recorder.source({ binding: 'p', document: documentRow(), row, stage: 'source' });
    recorder.stage(stageStat('source'));

    expect(recorder.output({ projected: {}, row, stage: 'return' })).toBeUndefined();
    expect(stageStats).toEqual([stageStat('source')]);
  });

  it('keeps compact binding origins for output rows', () => {
    const recorder = createLineageRecorder('compact', []);
    const sourceRow: RowRecord = { p: documentRow() };
    const outputRow: RowRecord = { name: 'Vini' };

    recorder.source({ binding: 'p', document: documentRow(), row: sourceRow, stage: 'source' });
    recorder.derive({ from: sourceRow, stage: 'with', to: outputRow });

    expect(recorder.output({ projected: { name: 'Vini' }, row: outputRow, stage: 'return' }))
      .toMatchObject({
        bindings: [{
          binding: 'p',
          sources: [{ provider: 'mem', rowPath: 'people/p1', source: '$people' }],
        }],
        mode: 'compact',
        readContribution: 1,
      });
  });

  it('records trace steps only in trace mode', () => {
    const recorder = createLineageRecorder('trace', []);
    const sourceRow: RowRecord = { p: documentRow() };
    const outputRow: RowRecord = { p: documentRow(), score: 1 };

    recorder.source({ binding: 'p', document: documentRow(), row: sourceRow, stage: 'source' });
    recorder.derive({ from: sourceRow, stage: 'lookup', to: outputRow });
    recorder.attach({ binding: 'score', row: outputRow, sources: [], stage: 'lookup' });

    expect(recorder.output({ projected: { score: 1 }, row: outputRow, stage: 'return' }))
      .toMatchObject({
        mode: 'trace',
        trace: [
          { action: 'source', binding: 'p', stage: 'source' },
          { action: 'derive', stage: 'lookup' },
          { action: 'attach', binding: 'score', stage: 'lookup' },
          { action: 'output', stage: 'return' },
        ],
      });
  });
});

function documentRow(): FdqlProviderRow {
  return {
    context: {},
    data: {},
    id: 'p1',
    path: 'people/p1',
    provider: 'mem',
    source: {
      provider: 'mem',
      sourceAlias: '$people',
      sourceType: 'collection',
      target: {},
    },
  };
}

function stageStat(stage: string): FdqlStageStats {
  return {
    aggregateReads: 0,
    durationMs: 5,
    droppedRows: 0,
    endedAtMs: 15,
    inputRows: 0,
    outputRows: 1,
    reads: 1,
    stage,
    startedAtMs: 10,
  };
}
