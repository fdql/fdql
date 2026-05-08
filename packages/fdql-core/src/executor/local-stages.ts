import { evaluateExpression, truthy } from '../evaluator.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  FdqlAggregateStage,
  FdqlDiagnostic,
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlExpression,
  FdqlFilterStage,
  FdqlProviderRow,
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
import { executeLookup } from './lookup.ts';
import { projectItems } from './projection.ts';
import { executeProviderAggregateStage } from './provider-aggregate.ts';
import { contextFor } from './provider-read.ts';
import type { LookupCache, MutableStats, RowRecord } from './types.ts';

export async function* applyLocalStages(
  plan: FdqlSingleReadPlan,
  sourceRows: readonly RowRecord[],
  sourceLineage: WeakMap<RowRecord, FdqlProviderRow>,
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
    readonly lineage: WeakMap<RowRecord, FdqlProviderRow>;
    readonly rows: readonly RowRecord[];
  }
  | { readonly kind: 'stopped'; readonly reason: NonNullable<FdqlStats['stoppedReason']>; },
  unknown
> {
  let rows = [...sourceRows];
  let lineage = sourceLineage;
  const takeCounts = new Map<number, number>();

  // oxlint-disable no-await-in-loop -- Local stages are ordered and lookup depends on current row values.
  for (const stage of plan.localStages) {
    if (stage.kind === 'filter') {
      rows = filterRows(stage, plan, rows, runtime);
    } else if (stage.kind === 'lookup') {
      const nextRows: RowRecord[] = [];
      const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
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
          copyLineage(lineage, nextLineage, row, lookup.row);
        }
      }
      rows = nextRows;
      lineage = nextLineage;
    } else if (stage.kind === 'providerAggregate') {
      const nextRows: RowRecord[] = [];
      const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
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
          copyLineage(lineage, nextLineage, row, aggregate.row);
        }
      }
      rows = nextRows;
      lineage = nextLineage;
    } else if (stage.kind === 'sortBy') {
      rows = sortRows(stage, plan, rows, runtime);
    } else if (stage.kind === 'unwind') {
      const nextRows: RowRecord[] = [];
      const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
      for (const row of rows) {
        for (const unwound of unwindRow(stage, plan, row, runtime)) {
          nextRows.push(unwound);
          copyLineage(lineage, nextLineage, row, unwound);
        }
      }
      rows = nextRows;
      lineage = nextLineage;
    } else if (stage.kind === 'with') {
      const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
      rows = rows.map((row) => {
        const projected = projectItems(stage.items, plan, row, runtime, 'internal');
        copyLineage(lineage, nextLineage, row, projected);
        return projected;
      });
      lineage = nextLineage;
    } else if (stage.kind === 'aggregate') {
      const aggregated = aggregateRows(stage, plan, rows, lineage, stats, runtime);
      rows = aggregated.rows;
      lineage = aggregated.lineage;
    } else if (stage.kind === 'take') {
      rows = takeRows(stage, rows, takeCounts);
    }
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
  lineage: WeakMap<RowRecord, FdqlProviderRow>,
  stats: MutableStats,
  runtime: FdqlProviderRuntimeRegistry,
): { readonly lineage: WeakMap<RowRecord, FdqlProviderRow>; readonly rows: RowRecord[]; } {
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
  const nextLineage = new WeakMap<RowRecord, FdqlProviderRow>();
  for (const group of groups.values()) {
    const output: RowRecord = {};
    for (const [index, item] of stage.groups.entries()) {
      output[item.alias ?? item.label] = group.keyValues[index];
    }
    for (const item of stage.items) {
      output[item.alias ?? item.label] = aggregateValue(item.expression, plan, group.rows, runtime);
    }
    nextRows.push(output);
    const source = group.rows.flatMap((row) => lineage.get(row) ? [lineage.get(row)!] : [])[0];
    if (source) nextLineage.set(output, source);
  }
  return { lineage: nextLineage, rows: nextRows };
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

function copyLineage(
  from: WeakMap<RowRecord, FdqlProviderRow>,
  to: WeakMap<RowRecord, FdqlProviderRow>,
  oldRow: RowRecord,
  newRow: RowRecord,
): void {
  const source = from.get(oldRow);
  if (source) to.set(newRow, source);
}

function unwindItems(value: FdqlValue): readonly FdqlValue[] {
  if (value.kind === 'array') return value.value;
  if (value.kind === 'map') return Object.values(value.value);
  return [];
}
