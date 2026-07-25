import { evaluateExpression } from '../evaluator.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  FdqlExpression,
  FdqlProjectionItem,
  FdqlProviderRow,
  FdqlSingleReadPlan,
  FdqlValue,
} from '../types.ts';
import {
  arrayValue,
  isFdqlValue,
  isMissingValue,
  mapValue,
  outputValue,
  toFdqlValue,
} from '../value.ts';
import { contextFor } from './provider-read.ts';
import type { RowRecord } from './types.ts';

export function projectItems(
  items: readonly FdqlProjectionItem[],
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
  mode: 'external' | 'internal',
): RowRecord {
  const projected: RowRecord = {};
  for (const item of items) {
    if (item.expression.kind === 'wildcard') {
      for (const [key, value] of Object.entries(expandWildcard(row, mode))) {
        assignProjection(projected, key, value);
      }
      continue;
    }
    const value = evaluateExpression(
      item.expression,
      contextFor(plan, row, runtime),
    );
    if (item.spread) {
      projectSpreadValue(projected, item, value, mode);
      continue;
    }
    const key = item.alias ?? labelFor(item.expression, item.label);
    if (mode === 'internal') {
      assignProjection(projected, key, value);
      continue;
    }
    const output = outputValue(value);
    if (output !== undefined) assignProjection(projected, key, output);
  }
  return projected;
}

function projectSpreadValue(
  projected: RowRecord,
  item: FdqlProjectionItem,
  value: FdqlValue,
  mode: 'external' | 'internal',
): void {
  if (isMissingValue(value)) return;
  if (value.kind === 'map') {
    for (const [key, entry] of Object.entries(value.value)) {
      if (mode === 'internal') {
        if (!isMissingValue(entry)) assignProjection(projected, key, entry);
        continue;
      }
      const output = outputValue(entry);
      if (output !== undefined) assignProjection(projected, key, output);
    }
    return;
  }
  const key = item.alias ?? labelFor(item.expression, item.label);
  if (mode === 'internal') {
    assignProjection(projected, key, value);
    return;
  }
  const output = outputValue(value);
  if (output !== undefined) assignProjection(projected, key, output);
}

function assignProjection(projected: RowRecord, key: string, value: unknown): void {
  projected[projectionKey(projected, key)] = value;
}

function projectionKey(projected: RowRecord, key: string): string {
  if (!(key in projected)) return key;
  for (let sequence = 2;; sequence += 1) {
    const next = `${key}_${sequence}`;
    if (!(next in projected)) return next;
  }
}

function expandWildcard(
  row: Record<string, unknown>,
  mode: 'external' | 'internal',
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).flatMap(([key, value]) => {
      const next = mode === 'internal' ? internalRowValue(value) : externalRowValue(value);
      return next === undefined ? [] : [[key, next]];
    }),
  );
}

function labelFor(expression: FdqlExpression, fallback: string): string {
  if (expression.kind === 'field') return expression.path.at(-1) ?? fallback;
  if (expression.kind === 'call') return expression.name.split('.').at(-1) ?? fallback;
  return fallback;
}

function isDocument(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'data' in value
    && 'id' in value
    && 'provider' in value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && !Array.isArray(value)
    && !isDocument(value);
}

function internalRowValue(value: unknown): unknown {
  if (isDocument(value)) return mapValue(value.data);
  if (isFdqlValue(value)) return value;
  if (Array.isArray(value)) {
    return arrayValue(
      value.map((item) => isDocument(item) ? mapValue(item.data) : toFdqlValue(item)),
    );
  }
  if (isPlainRecord(value)) return mapValue(value as Record<string, FdqlValue>);
  return value;
}

function externalRowValue(value: unknown): unknown {
  if (isDocument(value)) return outputValue(mapValue(value.data));
  if (isFdqlValue(value)) return outputValue(value);
  if (Array.isArray(value)) {
    return outputValue(
      arrayValue(value.map((item) => isDocument(item) ? mapValue(item.data) : toFdqlValue(item))),
    );
  }
  if (isPlainRecord(value)) return outputValue(mapValue(value as Record<string, FdqlValue>));
  if (value === null) return null;
  return value;
}
