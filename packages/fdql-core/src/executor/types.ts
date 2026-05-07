import type { FdqlProviderRow, FdqlStats } from '../types.ts';

export type RowRecord = Record<string, unknown>;

export type LookupCache = Map<string, readonly FdqlProviderRow[]>;

export type MutableStats = {
  -readonly [Key in keyof FdqlStats]: Key extends 'providerReads' ? Record<string, number>
    : FdqlStats[Key];
};
