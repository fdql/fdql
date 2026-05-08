import { diagnosticFromError } from './executor/errors.ts';
import { applyLocalStages } from './executor/local-stages.ts';
import { projectItems } from './executor/projection.ts';
import {
  aggregateProvider,
  createAggregateRequest,
  createReadRequest,
  readProvider,
} from './executor/provider-read.ts';
import {
  createStats,
  freezeStats,
  providerReadControls,
  recordAggregateRead,
  recordRead,
  stopEvents,
  stopReasonFor,
} from './executor/stats.ts';
import type { LookupCache, MutableStats, RowRecord } from './executor/types.ts';
import type { FdqlProviderRuntimeRegistry } from './provider.ts';
import type {
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlProviderRow,
  FdqlReadPlan,
  FdqlSingleReadPlan,
  FdqlStats,
} from './types.ts';

export async function* executeFdql(
  plan: FdqlReadPlan,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions = {},
): AsyncIterable<FdqlExecutionEvent> {
  const startedAt = options.now?.() ?? Date.now();
  const stats = createStats(plan.settings.readBudget);
  const lookupCache: LookupCache = new Map();
  yield { kind: 'started' };

  try {
    if (plan.kind === 'union') {
      for (const [index, branch] of plan.branches.entries()) {
        stats.unionBranches += 1;
        const result = yield* executeReadBranch(
          branch,
          runtime,
          options,
          stats,
          startedAt,
          lookupCache,
          index,
        );
        if (result === 'stopped') return;
      }
    } else {
      const result = yield* executeReadBranch(
        plan,
        runtime,
        options,
        stats,
        startedAt,
        lookupCache,
      );
      if (result === 'stopped') return;
    }
    stats.stoppedReason = 'completed';
    yield { kind: 'completed', stats: freezeStats(stats) };
  } catch (error) {
    yield {
      diagnostic: diagnosticFromError(error),
      kind: 'failed',
    };
  }
}

async function* executeReadBranch(
  plan: FdqlSingleReadPlan,
  runtime: FdqlProviderRuntimeRegistry,
  options: FdqlExecutionOptions,
  stats: MutableStats,
  startedAt: number,
  lookupCache: LookupCache,
  unionBranch?: number | undefined,
): AsyncGenerator<FdqlExecutionEvent, 'done' | 'stopped', unknown> {
  const request = createReadRequest(plan.provider, plan, plan.rowAlias, stats, 'source');
  const sourceRows: RowRecord[] = [];
  const sourceLineage = new WeakMap<RowRecord, FdqlProviderRow>();
  let readStopReason: NonNullable<FdqlStats['stoppedReason']> | undefined;

  const beforeReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (beforeReadStop) {
    stats.stoppedReason = beforeReadStop;
    for (const event of stopEvents(stats, beforeReadStop)) yield event;
    return 'stopped';
  }

  if (plan.providerAggregate) {
    const aggregateRequest = createAggregateRequest(
      plan.provider,
      plan.providerAggregate,
      plan,
      stats,
      undefined,
      'sourceAggregate',
    );
    const aggregate = await aggregateProvider(
      runtime,
      aggregateRequest,
      providerReadControls(plan, options, startedAt),
    );
    if (aggregate.aggregateReads > 0) {
      recordAggregateRead(aggregateRequest, stats, aggregate.aggregateReads);
    }
    for (const document of aggregate.documentReads ?? []) {
      yield recordRead(document, request, stats, false);
      sourceLineage.set(aggregate.values, document);
    }
    sourceRows.push(aggregate.values);
  } else {
    for await (
      const document of readProvider(
        runtime,
        request,
        providerReadControls(plan, options, startedAt),
      )
    ) {
      const beforeRowStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
      if (beforeRowStop) {
        stats.stoppedReason = beforeRowStop;
        for (const event of stopEvents(stats, beforeRowStop)) yield event;
        return 'stopped';
      }
      yield recordRead(document, request, stats, false);
      const row = { [plan.rowAlias]: document };
      sourceRows.push(row);
      sourceLineage.set(row, document);
      if (stats.reads >= plan.settings.readBudget) {
        readStopReason = 'budget';
        break;
      }
    }
  }

  const afterReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (afterReadStop) {
    stats.stoppedReason = afterReadStop;
    for (const event of stopEvents(stats, afterReadStop)) yield event;
    return 'stopped';
  }

  const localResult = yield* applyLocalStages(
    plan,
    sourceRows,
    sourceLineage,
    runtime,
    stats,
    startedAt,
    options,
    lookupCache,
  );
  if (localResult.kind === 'failed') {
    yield { diagnostic: localResult.diagnostic, kind: 'failed' };
    return 'stopped';
  }
  if (localResult.kind === 'stopped') {
    stats.stoppedReason = localResult.reason;
    for (const event of stopEvents(stats, localResult.reason)) yield event;
    return 'stopped';
  }

  for (const row of localResult.rows) {
    const document = localResult.lineage.get(row)
      ?? sourceRows.flatMap((item) => sourceLineage.get(item) ? [sourceLineage.get(item)!] : [])[0];
    const projected = projectItems(plan.returnStage.items, plan, row, runtime, 'external');
    stats.rowsOutput += 1;
    yield {
      kind: 'row',
      lineage: {
        provider: document?.provider ?? plan.provider.source.provider,
        rowPath: document?.path ?? '',
        readContribution: 1,
        source: unionBranch === undefined
          ? plan.provider.source.sourceAlias
          : `${plan.provider.source.sourceAlias}#${unionBranch + 1}`,
      },
      row: projected,
    };
    yield { kind: 'stats', stats: freezeStats(stats) };
    const rowStopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
    if (rowStopReason && rowStopReason !== 'budget') {
      stats.stoppedReason = rowStopReason;
      for (const event of stopEvents(stats, rowStopReason)) yield event;
      return 'stopped';
    }
  }

  if (readStopReason) {
    stats.stoppedReason = readStopReason;
    for (const event of stopEvents(stats, readStopReason)) yield event;
    return 'stopped';
  }
  return 'done';
}
