import type { FdqlStageStats } from '../types.ts';

export interface FdqlStageTimer {
  readonly startedAtMs: number;
}

export type FdqlUntimedStageStats = Omit<
  FdqlStageStats,
  'durationMs' | 'endedAtMs' | 'startedAtMs'
>;

export function startStage(now: () => number): FdqlStageTimer {
  return { startedAtMs: now() };
}

export function finishStage(
  timer: FdqlStageTimer,
  now: () => number,
  stats: FdqlUntimedStageStats,
): FdqlStageStats {
  const endedAtMs = now();
  return {
    ...stats,
    durationMs: Math.max(0, endedAtMs - timer.startedAtMs),
    endedAtMs,
    startedAtMs: timer.startedAtMs,
  };
}
