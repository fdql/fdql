import { providerKey } from '../provider.ts';
import type {
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlProviderAggregateRequest,
  FdqlProviderReadControls,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlReadPlan,
  FdqlStats,
} from '../types.ts';
import type { MutableStats } from './types.ts';

export function createStats(readBudget: number): MutableStats {
  return {
    aggregateReads: 0,
    aggregateSourceRows: 0,
    cacheBytes: 0,
    cacheEvictions: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheWrites: 0,
    lookupReads: 0,
    providerAggregateReads: {},
    providerReads: {},
    readBudget,
    reads: 0,
    rowsOutput: 0,
    rowsScanned: 0,
    unionBranches: 0,
  };
}

export function recordAggregateRead(
  request: FdqlProviderAggregateRequest,
  stats: MutableStats,
  count: number,
): void {
  stats.aggregateReads += count;
  const projectId = typeof request.source.target['projectId'] === 'string'
    ? request.source.target['projectId']
    : '';
  const key = providerKey(request.source.provider, projectId);
  stats.providerAggregateReads[key] = (stats.providerAggregateReads[key] ?? 0) + count;
}

export function recordRead(
  document: FdqlProviderRow,
  request: FdqlProviderReadRequest,
  stats: MutableStats,
  lookup: boolean,
): Extract<FdqlExecutionEvent, { readonly kind: 'read'; }> {
  stats.reads += 1;
  if (lookup) stats.lookupReads += 1;
  stats.rowsScanned += 1;
  const key = providerKey(document.provider, String(document.context.projectId ?? ''));
  stats.providerReads[key] = (stats.providerReads[key] ?? 0) + 1;
  return {
    count: 1,
    kind: 'read',
    provider: document.provider,
    source: request.source.sourceAlias,
  };
}

export function stopReasonFor(
  plan: FdqlReadPlan,
  stats: MutableStats,
  startedAt: number,
  options: FdqlExecutionOptions,
  phase: 'afterRow' | 'beforeRow',
): FdqlStats['stoppedReason'] {
  if (options.signal?.aborted) return 'cancelled';
  const now = options.now?.() ?? Date.now();
  if (now - startedAt >= plan.settings.timeoutMs) return 'timeout';
  if (phase === 'afterRow' && stats.reads >= plan.settings.readBudget) return 'budget';
  return undefined;
}

export function providerReadControls(
  plan: FdqlReadPlan,
  options: FdqlExecutionOptions,
  startedAt: number,
): FdqlProviderReadControls {
  return {
    deadlineAtMs: startedAt + plan.settings.timeoutMs,
    now: options.now ?? (() => Date.now()),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

export function stopEvents(
  stats: MutableStats,
  stopReason: NonNullable<FdqlStats['stoppedReason']>,
): readonly FdqlExecutionEvent[] {
  const frozen = freezeStats(stats);
  return [
    { kind: 'stats', stats: frozen },
    stopReason === 'cancelled'
      ? { kind: 'cancelled', stats: frozen }
      : { kind: 'completed', stats: frozen },
  ];
}

export function freezeStats(stats: MutableStats): FdqlStats {
  return {
    aggregateReads: stats.aggregateReads,
    aggregateSourceRows: stats.aggregateSourceRows,
    cacheBytes: stats.cacheBytes,
    cacheEvictions: stats.cacheEvictions,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    cacheWrites: stats.cacheWrites,
    lookupReads: stats.lookupReads,
    providerAggregateReads: { ...stats.providerAggregateReads },
    providerReads: { ...stats.providerReads },
    readBudget: stats.readBudget,
    reads: stats.reads,
    rowsOutput: stats.rowsOutput,
    rowsScanned: stats.rowsScanned,
    ...(stats.stoppedReason ? { stoppedReason: stats.stoppedReason } : {}),
    unionBranches: stats.unionBranches,
  };
}
