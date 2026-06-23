import { describe, expect, it } from 'vitest';
import { finishStage, startStage } from './stage-timing.ts';

describe('FDQL executor stage timing', () => {
  it('adds stage wall-clock timing to stage stats', () => {
    const times = [100, 137];
    const now = () => times.shift() ?? 137;
    const timer = startStage(now);

    expect(
      finishStage(timer, now, {
        aggregateReads: 0,
        droppedRows: 0,
        inputRows: 1,
        outputRows: 1,
        reads: 0,
        stage: 'filter',
      }),
    ).toEqual({
      aggregateReads: 0,
      droppedRows: 0,
      durationMs: 37,
      endedAtMs: 137,
      inputRows: 1,
      outputRows: 1,
      reads: 0,
      stage: 'filter',
      startedAtMs: 100,
    });
  });

  it('clamps negative durations to zero', () => {
    const times = [200, 180];
    const now = () => times.shift() ?? 180;

    expect(
      finishStage(startStage(now), now, {
        aggregateReads: 0,
        droppedRows: 0,
        inputRows: 0,
        outputRows: 0,
        reads: 0,
        stage: 'source',
      }).durationMs,
    ).toBe(0);
  });
});
