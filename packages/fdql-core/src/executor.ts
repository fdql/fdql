import { diagnosticFromError } from './executor/errors.ts';
import {
  aggregateLineageBindings,
  createLineageRecorder,
  lineageSourceForProviderSource,
  lineageSourcesForRows,
} from './executor/lineage.ts';
import { applyLocalStages } from './executor/local-stages.ts';
import { projectItems } from './executor/projection.ts';
import { providerAggregateOutputRow } from './executor/provider-aggregate.ts';
import {
  aggregateProvider,
  createAggregateRequest,
  createReadRequest,
  readProvider,
} from './executor/provider-read.ts';
import { finishStage, startStage } from './executor/stage-timing.ts';
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
  const lineage = createLineageRecorder(plan.settings.lineage, stats.stageStats);
  let readStopReason: NonNullable<FdqlStats['stoppedReason']> | undefined;
  const sourceReadsBefore = stats.reads;
  const sourceAggregatesBefore = stats.aggregateReads;
  const now = options.now ?? (() => Date.now());

  const beforeReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (beforeReadStop) {
    stats.stoppedReason = beforeReadStop;
    for (const event of stopEvents(stats, beforeReadStop)) yield event;
    return 'stopped';
  }

  const sourceStage = startStage(now);
  const recordSourceStage = () =>
    lineage.stage(
      finishStage(sourceStage, now, {
        aggregateReads: stats.aggregateReads - sourceAggregatesBefore,
        droppedRows: 0,
        inputRows: 0,
        outputRows: sourceRows.length,
        provider: plan.provider.source.provider,
        reads: stats.reads - sourceReadsBefore,
        source: plan.provider.source.sourceAlias,
        stage: plan.providerAggregate ? 'sourceAggregate' : 'source',
      }),
    );
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
    const aggregateRow = providerAggregateOutputRow(plan.providerAggregate, aggregate.values);
    for (const document of aggregate.documentReads ?? []) {
      yield recordRead(document, request, stats, false);
    }
    const sources = (aggregate.documentReads?.length ?? 0) > 0
      ? lineageSourcesForRows(aggregate.documentReads ?? [], 'sourceAggregate')
      : [
        lineageSourceForProviderSource(
          plan.provider.source,
          'sourceAggregate',
          aggregate.aggregateReads,
        ),
      ];
    for (const binding of aggregateLineageBindings(plan.providerAggregate, sources)) {
      lineage.attach({ ...binding, row: aggregateRow, stage: 'sourceAggregate' });
    }
    sourceRows.push(aggregateRow);
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
        recordSourceStage();
        for (const event of stopEvents(stats, beforeRowStop)) yield event;
        return 'stopped';
      }
      yield recordRead(document, request, stats, false);
      const row = { [plan.rowAlias]: document };
      sourceRows.push(row);
      lineage.source({ binding: plan.rowAlias, document, row, stage: 'source' });
      if (stats.reads >= plan.settings.readBudget) {
        readStopReason = 'budget';
        break;
      }
    }
  }
  recordSourceStage();

  const afterReadStop = stopReasonFor(plan, stats, startedAt, options, 'beforeRow');
  if (afterReadStop) {
    stats.stoppedReason = afterReadStop;
    for (const event of stopEvents(stats, afterReadStop)) yield event;
    return 'stopped';
  }

  const localResult = yield* applyLocalStages(
    plan,
    sourceRows,
    lineage,
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

  const outputRowsBefore = stats.rowsOutput;
  const returnStage = startStage(now);
  for (const row of localResult.rows) {
    const projected = projectItems(plan.returnStage.items, plan, row, runtime, 'external');
    stats.rowsOutput += 1;
    const rowEvent: Extract<FdqlExecutionEvent, { readonly kind: 'row'; }> = {
      kind: 'row',
      row: projected,
    };
    const rowLineage = localResult.lineage.output({
      projected,
      row,
      stage: unionBranch === undefined ? 'return' : `return#${unionBranch + 1}`,
    });
    yield rowLineage ? { ...rowEvent, lineage: rowLineage } : rowEvent;
    yield { kind: 'stats', stats: freezeStats(stats) };
    const rowStopReason = stopReasonFor(plan, stats, startedAt, options, 'afterRow');
    if (rowStopReason && rowStopReason !== 'budget') {
      stats.stoppedReason = rowStopReason;
      localResult.lineage.stage(
        finishStage(returnStage, now, {
          aggregateReads: 0,
          droppedRows: 0,
          inputRows: localResult.rows.length,
          outputRows: stats.rowsOutput - outputRowsBefore,
          reads: 0,
          stage: 'return',
        }),
      );
      for (const event of stopEvents(stats, rowStopReason)) yield event;
      return 'stopped';
    }
  }
  localResult.lineage.stage(
    finishStage(returnStage, now, {
      aggregateReads: 0,
      droppedRows: 0,
      inputRows: localResult.rows.length,
      outputRows: stats.rowsOutput - outputRowsBefore,
      reads: 0,
      stage: 'return',
    }),
  );

  if (readStopReason) {
    stats.stoppedReason = readStopReason;
    for (const event of stopEvents(stats, readStopReason)) yield event;
    return 'stopped';
  }
  return 'done';
}
