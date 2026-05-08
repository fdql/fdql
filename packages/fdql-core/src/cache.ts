import { evaluateExpression } from './evaluator.ts';
import type { FdqlProviderDialectRegistry } from './provider.ts';
import type {
  EvalRows,
  FdqlExpression,
  FdqlPersistentCacheKey,
  FdqlProviderAggregateRequest,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlValue,
} from './types.ts';

export const FDQL_CACHE_FORMAT_VERSION = 1;

export interface FdqlProviderReadCacheKeyInput {
  readonly cacheContext?: Readonly<Record<string, unknown>> | undefined;
  readonly providers?: FdqlProviderDialectRegistry | undefined;
  readonly readLimit?: number | undefined;
  readonly request: FdqlProviderReadRequest;
}

export interface FdqlProviderAggregateCacheKeyInput {
  readonly cacheContext?: Readonly<Record<string, unknown>> | undefined;
  readonly providers?: FdqlProviderDialectRegistry | undefined;
  readonly request: FdqlProviderAggregateRequest;
}

export function createFdqlProviderReadCacheKey(
  input: FdqlProviderReadCacheKeyInput,
): FdqlPersistentCacheKey {
  const { request } = input;
  const key = {
    cacheContext: stableValue(input.cacheContext ?? {}),
    fieldMask: normalizedFieldMask(request),
    formatVersion: FDQL_CACHE_FORMAT_VERSION,
    limit: input.readLimit ?? request.limit ?? null,
    orderBy: request.orderBy
      ? {
        direction: request.orderBy.direction,
        expression: normalizedExpression(request.orderBy.expression, input),
      }
      : null,
    predicate: request.predicate ? normalizedExpression(request.predicate, input) : null,
    provider: request.source.provider,
    providerCacheVersion: input.providers?.[request.source.provider]?.cacheVersion ?? 1,
    source: {
      provider: request.source.provider,
      sourceType: request.source.sourceType,
      target: stableValue(request.source.target),
    },
  };
  return {
    canonicalJson: stableStringify(key),
    key,
  };
}

export function createFdqlProviderAggregateCacheKey(
  input: FdqlProviderAggregateCacheKeyInput,
): FdqlPersistentCacheKey {
  const { request } = input;
  const key = {
    aggregates: request.aggregates.map((aggregate) => ({
      alias: aggregate.alias,
      expression: aggregate.expression ? normalizedExpression(aggregate.expression, input) : null,
      functionName: aggregate.functionName,
    })),
    cacheContext: stableValue(input.cacheContext ?? {}),
    formatVersion: FDQL_CACHE_FORMAT_VERSION,
    predicate: request.predicate ? normalizedExpression(request.predicate, input) : null,
    provider: request.source.provider,
    providerCacheVersion: input.providers?.[request.source.provider]?.cacheVersion ?? 1,
    source: {
      provider: request.source.provider,
      sourceType: request.source.sourceType,
      target: stableValue(request.source.target),
    },
    type: 'aggregate',
  };
  return {
    canonicalJson: stableStringify(key),
    key,
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value)) ?? 'undefined';
}

function normalizedFieldMask(
  request: FdqlProviderReadRequest,
):
  | { readonly fields: readonly (readonly string[])[]; readonly kind: 'fields'; }
  | { readonly kind: 'full'; }
{
  if (!request.fieldMask) return { kind: 'full' };
  return {
    fields: sortedUniqueSegments(request.fieldMask.map((field) => field.segments)),
    kind: 'fields',
  };
}

function normalizedExpression(
  expression: FdqlExpression,
  input: FdqlProviderAggregateCacheKeyInput | FdqlProviderReadCacheKeyInput,
): unknown {
  if (
    expression.kind === 'binary' && (expression.operator === 'and' || expression.operator === 'or')
  ) {
    const items = flattenBinary(expression, expression.operator).map((item) =>
      normalizedExpression(item, input)
    );
    return {
      kind: 'binarySet',
      operator: expression.operator,
      items: sortBy(items, stableStringify),
    };
  }
  if (expression.kind === 'binary') {
    return {
      kind: 'binary',
      left: normalizedExpression(expression.left, input),
      operator: expression.operator,
      right: normalizedExpression(expression.right, input),
    };
  }
  if (expression.kind === 'field') {
    const head = expression.path[0];
    if (head === input.request.rowAlias) {
      return { kind: 'field', path: ['$row', ...expression.path.slice(1)] };
    }
    if (head && input.request.rows && Object.hasOwn(input.request.rows, head)) {
      return {
        kind: 'correlatedValue',
        value: stableValue(evaluateCorrelatedExpression(expression, input)),
      };
    }
    return { kind: 'field', path: expression.path };
  }
  if (expression.kind === 'call') {
    if (containsCorrelatedReference(expression, input.request)) {
      return {
        kind: 'correlatedValue',
        value: stableValue(evaluateCorrelatedExpression(expression, input)),
      };
    }
    return {
      args: expression.args.map((arg) => normalizedExpression(arg, input)),
      kind: 'call',
      name: expression.name,
    };
  }
  if (expression.kind === 'array') {
    return {
      items: expression.items.map((item) => normalizedExpression(item, input)),
      kind: 'array',
    };
  }
  if (expression.kind === 'map') {
    return {
      entries: sortBy(
        expression.entries.map((entry) => ({
          key: entry.key,
          value: normalizedExpression(entry.value, input),
        })),
        (entry) => entry.key,
      ),
      kind: 'map',
    };
  }
  if (expression.kind === 'case') {
    return {
      branches: expression.branches.map((branch) => ({
        condition: normalizedExpression(branch.condition, input),
        value: normalizedExpression(branch.value, input),
      })),
      elseExpression: expression.elseExpression
        ? normalizedExpression(expression.elseExpression, input)
        : null,
      kind: 'case',
    };
  }
  if (expression.kind === 'unary') {
    return {
      expression: normalizedExpression(expression.expression, input),
      kind: 'unary',
      operator: expression.operator,
    };
  }
  if (expression.kind === 'postfix') {
    return {
      expression: normalizedExpression(expression.expression, input),
      kind: 'postfix',
      operator: expression.operator,
    };
  }
  if (expression.kind === 'alias') {
    return {
      kind: 'aliasValue',
      value: stableValue(evaluateCorrelatedExpression(expression, input)),
    };
  }
  if (expression.kind === 'literal') {
    return { kind: 'literal', value: expression.value };
  }
  if (expression.kind === 'wildcard') {
    return { kind: 'wildcard' };
  }
  return expression;
}

function flattenBinary(
  expression: FdqlExpression,
  operator: 'and' | 'or',
): readonly FdqlExpression[] {
  if (expression.kind !== 'binary' || expression.operator !== operator) return [expression];
  return [
    ...flattenBinary(expression.left, operator),
    ...flattenBinary(expression.right, operator),
  ];
}

function containsCorrelatedReference(
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): boolean {
  if (!request.rows) return false;
  if (expression.kind === 'field') {
    const head = expression.path[0];
    return Boolean(head && head !== request.rowAlias && Object.hasOwn(request.rows, head));
  }
  if (expression.kind === 'call') {
    return expression.args.some((arg) => containsCorrelatedReference(arg, request));
  }
  if (expression.kind === 'array') {
    return expression.items.some((item) => containsCorrelatedReference(item, request));
  }
  if (expression.kind === 'map') {
    return expression.entries.some((entry) => containsCorrelatedReference(entry.value, request));
  }
  if (expression.kind === 'case') {
    return expression.branches.some((branch) =>
      containsCorrelatedReference(branch.condition, request)
      || containsCorrelatedReference(branch.value, request)
    )
      || Boolean(
        expression.elseExpression
          && containsCorrelatedReference(expression.elseExpression, request),
      );
  }
  if (expression.kind === 'unary') {
    return containsCorrelatedReference(expression.expression, request);
  }
  if (expression.kind === 'postfix') {
    return containsCorrelatedReference(expression.expression, request);
  }
  if (expression.kind === 'binary') {
    return containsCorrelatedReference(expression.left, request)
      || containsCorrelatedReference(expression.right, request);
  }
  return false;
}

function evaluateCorrelatedExpression(
  expression: FdqlExpression,
  input: FdqlProviderAggregateCacheKeyInput | FdqlProviderReadCacheKeyInput,
): FdqlValue {
  return evaluateExpression(expression, {
    aliases: input.request.aliases,
    providers: input.providers,
    rows: input.request.rows as EvalRows | undefined,
  });
}

function stableValue(value: unknown): unknown {
  if (isFdqlValue(value)) return stableFdqlValue(value);
  if (isProviderRow(value)) {
    return {
      context: stableValue(value.context),
      data: stableValue(value.data),
      id: value.id,
      path: value.path,
      provider: value.provider,
      source: {
        provider: value.source.provider,
        sourceType: value.source.sourceType,
        target: stableValue(value.source.target),
      },
      type: 'providerRow',
    };
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(sortedKeys(value).map((key) => [key, stableValue(value[key])]));
  }
  if (value === undefined) return { type: 'undefined' };
  return value;
}

function stableFdqlValue(value: FdqlValue): unknown {
  switch (value.kind) {
    case 'array':
      return { kind: value.kind, value: value.value.map(stableFdqlValue) };
    case 'map':
      return { kind: value.kind, value: stableValue(value.value) };
    case 'providerValue':
      return {
        display: value.display,
        equalityKey: value.equalityKey,
        kind: value.kind,
        orderKey: value.orderKey,
        provider: value.provider,
        value: stableValue(value.value),
        valueType: value.valueType,
      };
    default:
      return value;
  }
}

function sortedKeys(value: Record<string, unknown>): readonly string[] {
  return sortBy(Object.keys(value), (key) => key);
}

function sortedUniqueSegments(
  values: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const unique = new Map(values.map((value) => [stableStringify(value), value]));
  return sortBy([...unique.values()], stableStringify);
}

function sortBy<Value>(values: readonly Value[], keyFor: (value: Value) => string): Value[] {
  const sorted = [...values];
  sorted.sort((left, right) => keyFor(left).localeCompare(keyFor(right)));
  return sorted;
}

function isFdqlValue(value: unknown): value is FdqlValue {
  return value !== null && typeof value === 'object' && 'kind' in value;
}

function isProviderRow(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'data' in value
    && 'id' in value
    && 'provider' in value
    && 'source' in value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && !Array.isArray(value)
    && !isProviderRow(value);
}
