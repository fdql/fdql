import { evaluateExpression } from '../evaluator.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  FdqlExpression,
  FdqlProjectionItem,
  FdqlProviderRow,
  FdqlSingleReadPlan,
  FdqlValue,
} from '../types.ts';
import { arrayValue, mapValue, outputValue, toFdqlValue } from '../value.ts';
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
      Object.assign(projected, expandWildcard(row, mode));
      continue;
    }
    const value = evaluateExpression(
      item.expression,
      contextFor(plan, row, runtime),
    );
    const key = item.alias ?? labelFor(item.expression, item.label);
    if (mode === 'internal') {
      projected[key] = value;
      continue;
    }
    const output = outputValue(value);
    if (output !== undefined) projected[key] = output;
  }
  return projected;
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
  if (Array.isArray(value)) {
    return outputValue(
      arrayValue(value.map((item) => isDocument(item) ? mapValue(item.data) : toFdqlValue(item))),
    );
  }
  if (isPlainRecord(value)) return outputValue(mapValue(value as Record<string, FdqlValue>));
  if (value === null) return null;
  if (isFdqlValue(value)) return outputValue(value);
  return value;
}

function isFdqlValue(value: unknown): value is FdqlValue {
  return value !== null && typeof value === 'object' && 'kind' in value;
}
