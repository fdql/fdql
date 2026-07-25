import type { FdqlProviderRow, FdqlStageStats, FdqlStats } from '../types.ts';

export type RowRecord = Record<string, unknown>;

export type LookupCache = Map<string, readonly FdqlProviderRow[]>;

export type MutableStats = {
  -readonly [Key in keyof FdqlStats]: Key extends 'providerAggregateReads' | 'providerReads'
    ? Record<string, number>
    : Key extends 'stageStats' ? FdqlStageStats[]
    : FdqlStats[Key];
};
