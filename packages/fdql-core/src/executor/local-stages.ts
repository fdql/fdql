import { evaluateExpression, truthy } from '../evaluator.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  FdqlAggregateStage,
  FdqlDiagnostic,
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlFilterStage,
  FdqlSingleReadPlan,
  FdqlSortByStage,
  FdqlStats,
  FdqlTakeStage,
  FdqlUnwindStage,
  FdqlValue,
} from '../types.ts';
import {
  compareValues,
  groupKey,
  isMissingValue,
  isNullValue,
  nullValue,
  numberValue,
  numericValue,
} from '../value.ts';
import type { FdqlLineageRecorder } from './lineage.ts';
import { executeLookup } from './lookup.ts';
import { projectItems } from './projection.ts';
import { executeProviderAggregateStage } from './provider-aggregate.ts';
import { contextFor } from './provider-read.ts';
import type { LookupCache, MutableStats, RowRecord } from './types.ts';

export async function* applyLocalStages(
  plan: FdqlSingleReadPlan,
  sourceRows: readonly RowRecord[],
  lineage: FdqlLineageRecorder,
  runtime: FdqlProviderRuntimeRegistry,
  stats: MutableStats,
  startedAt: number,
  options: FdqlExecutionOptions,
  lookupCache: LookupCache,
): AsyncGenerator<
  FdqlExecutionEvent,
  | { readonly kind: 'failed'; readonly diagnostic: FdqlDiagnostic; }
  | {
    readonly kind: 'rows';
    readonly lineage: FdqlLineageRecorder;
    readonly rows: readonly RowRecord[];
  }
  | { readonly kind: 'stopped'; readonly reason: NonNullable<FdqlStats['stoppedReason']>; },
  unknown
> {
  let rows = [...sourceRows];
  const takeCounts = new Map<number, number>();

  // oxlint-disable no-await-in-loop -- Local stages are ordered and lookup depends on current row values.
  for (const stage of plan.localStages) {
    const inputRows = rows;
    const readsBefore = stats.reads;
    const aggregateReadsBefore = stats.aggregateReads;
    if (stage.kind === 'filter') {
      rows = filterRows(stage, plan, rows, runtime);
      for (const row of inputRows) {
        if (!rows.includes(row)) lineage.drop({ reason: 'filtered', row, stage: 'filter' });
      }
    } else if (stage.kind === 'lookup') {
      const nextRows: RowRecord[] = [];
      for (const row of rows) {
        const lookup = await executeLookup(
          stage,
          plan,
          row,
          runtime,
          stats,
          options,
          startedAt,
          lookupCache,
        );
        for (const event of lookup.events) yield event;
        if (lookup.diagnostic) return { diagnostic: lookup.diagnostic, kind: 'failed' };
        if (lookup.stopReason) return { kind: 'stopped', reason: lookup.stopReason };
        if (lookup.row) {
          nextRows.push(lookup.row);
          lineage.derive({ from: row, stage: 'lookup', to: lookup.row });
          if (lookup.lineage) {
            lineage.attach({ ...lookup.lineage, row: lookup.row, stage: 'lookup' });
          }
        } else {
          lineage.drop({ reason: 'lookup required', row, stage: 'lookup' });
        }
      }
      rows = nextRows;
    } else if (stage.kind === 'providerAggregate') {
      const nextRows: RowRecord[] = [];
      for (const row of rows) {
        const aggregate = await executeProviderAggregateStage(
          stage,
          plan,
          row,
          runtime,
          stats,
          options,
          startedAt,
          lookupCache,
        );
        for (const event of aggregate.events) yield event;
        if (aggregate.diagnostic) return { diagnostic: aggregate.diagnostic, kind: 'failed' };
        if (aggregate.stopReason) return { kind: 'stopped', reason: aggregate.stopReason };
        if (aggregate.row) {
          nextRows.push(aggregate.row);
          lineage.derive({ from: row, stage: 'providerAggregate', to: aggregate.row });
          for (const binding of aggregate.lineage) {
            lineage.attach({ ...binding, row: aggregate.row, stage: 'providerAggregate' });
          }
        } else {
          lineage.drop({ reason: 'provider aggregate', row, stage: 'providerAggregate' });
        }
      }
      rows = nextRows;
    } else if (stage.kind === 'sortBy') {
      rows = sortRows(stage, plan, rows, runtime);
      for (const row of rows) lineage.derive({ from: row, stage: 'sortBy', to: row });
    } else if (stage.kind === 'unwind') {
      const nextRows: RowRecord[] = [];
      for (const row of rows) {
        for (const unwound of unwindRow(stage, plan, row, runtime)) {
          nextRows.push(unwound);
          lineage.derive({ from: row, stage: 'unwind', to: unwound });
        }
      }
      rows = nextRows;
    } else if (stage.kind === 'with') {
      rows = rows.map((row) => {
        const projected = projectItems(stage.items, plan, row, runtime, 'internal');
        lineage.derive({ from: row, stage: 'with', to: projected });
        return projected;
      });
    } else if (stage.kind === 'aggregate') {
      const aggregated = aggregateRows(stage, plan, rows, lineage, stats, runtime);
      rows = aggregated.rows;
    } else if (stage.kind === 'take') {
      rows = takeRows(stage, rows, takeCounts);
      for (const row of inputRows) {
        if (!rows.includes(row)) lineage.drop({ reason: 'taken', row, stage: 'take' });
      }
    }
    lineage.stage({
      aggregateReads: stats.aggregateReads - aggregateReadsBefore,
      droppedRows: Math.max(0, inputRows.length - rows.length),
      inputRows: inputRows.length,
      outputRows: rows.length,
      reads: stats.reads - readsBefore,
      stage: stage.kind,
    });
    if (rows.length === 0) break;
  }
  // oxlint-enable no-await-in-loop

  return { kind: 'rows', lineage, rows };
}

function filterRows(
  stage: FdqlFilterStage,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  runtime: FdqlProviderRuntimeRegistry,
): RowRecord[] {
  return rows.filter((row) =>
    truthy(evaluateExpression(stage.expression, contextFor(plan, row, runtime)))
  );
}

function sortRows(
  stage: FdqlSortByStage,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  runtime: FdqlProviderRuntimeRegistry,
): RowRecord[] {
  const direction = stage.direction === 'desc' ? -1 : 1;
  const sorted: RowRecord[] = [];
  for (const row of rows) {
    const index = sorted.findIndex((candidate) =>
      compareValues(
            evaluateExpression(stage.expression, contextFor(plan, row, runtime)),
            evaluateExpression(stage.expression, contextFor(plan, candidate, runtime)),
          ) * direction < 0
    );
    if (index < 0) sorted.push(row);
    else sorted.splice(index, 0, row);
  }
  return sorted;
}

function takeRows(
  stage: FdqlTakeStage,
  rows: readonly RowRecord[],
  takeCounts: Map<number, number>,
): RowRecord[] {
  const taken = takeCounts.get(stage.line) ?? 0;
  const remaining = Math.max(0, stage.value - taken);
  const selected = rows.slice(0, remaining);
  takeCounts.set(stage.line, taken + selected.length);
  return selected;
}

function unwindRow(
  stage: FdqlUnwindStage,
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
): RowRecord[] {
  const value = evaluateExpression(stage.expression, contextFor(plan, row, runtime));
  return unwindItems(value).map((item) => ({ ...row, [stage.rowAlias]: item }));
}

function aggregateRows(
  stage: FdqlAggregateStage,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  lineage: FdqlLineageRecorder,
  stats: MutableStats,
  runtime: FdqlProviderRuntimeRegistry,
): { readonly rows: RowRecord[]; } {
  stats.aggregateSourceRows += rows.length;
  const groups = new Map<
    string,
    { readonly keyValues: readonly FdqlValue[]; readonly rows: RowRecord[]; }
  >();
  for (const row of rows) {
    const keyValues = stage.groups.map((group) =>
      evaluateExpression(group.expression, contextFor(plan, row, runtime))
    );
    const key = keyValues.map(groupKey).join('\u001f');
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { keyValues, rows: [row] });
  }
  if (!stage.groups.length && !groups.size) groups.set('', { keyValues: [], rows: [] });

  const nextRows: RowRecord[] = [];
  for (const group of groups.values()) {
    const output: RowRecord = {};
    for (const [index, item] of stage.groups.entries()) {
      output[item.alias ?? item.label] = group.keyValues[index];
    }
    for (const item of stage.items) {
      output[item.alias ?? item.label] = aggregateValue(item.expression, plan, group.rows, runtime);
    }
    nextRows.push(output);
    if (group.rows[0]) lineage.derive({ from: group.rows[0], stage: 'aggregate', to: output });
  }
  return { rows: nextRows };
}

function aggregateValue(
  expression: FdqlExpression,
  plan: FdqlSingleReadPlan,
  rows: readonly RowRecord[],
  runtime: FdqlProviderRuntimeRegistry,
): FdqlValue {
  if (expression.kind !== 'call') return nullValue;
  if (expression.name === 'count') return numberValue(rows.length);
  const values = rows.map((row) =>
    evaluateExpression(expression.args[0]!, contextFor(plan, row, runtime))
  )
    .filter((value) => !isNullValue(value) && !isMissingValue(value));
  if (expression.name === 'sum') {
    return numberValue(values.reduce<number>((total, value) => total + numericValue(value), 0));
  }
  if (expression.name === 'avg') {
    return values.length
      ? numberValue(
        values.reduce<number>((total, value) => total + numericValue(value), 0) / values.length,
      )
      : nullValue;
  }
  if (expression.name === 'min') return minMax(values, 'min');
  if (expression.name === 'max') return minMax(values, 'max');
  return nullValue;
}

function minMax(values: readonly FdqlValue[], mode: 'max' | 'min'): FdqlValue {
  let selected: FdqlValue | undefined;
  for (const value of values) {
    const direction = mode === 'max' ? 1 : -1;
    if (selected === undefined || compareValues(value, selected) * direction > 0) {
      selected = value;
    }
  }
  return selected ?? nullValue;
}

function unwindItems(value: FdqlValue): readonly FdqlValue[] {
  if (value.kind === 'array') return value.value;
  if (value.kind === 'map') return Object.values(value.value);
  return [];
}
