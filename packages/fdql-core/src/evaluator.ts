import { providerNamespaceFromCall } from './provider.ts';
import type { FdqlProviderDialectRegistry } from './provider.ts';
import type { EvalRows, FdqlExpression, FdqlProviderRow, FdqlValue } from './types.ts';
import {
  arrayValue,
  booleanValue,
  bytesValue,
  compareValues,
  equalValues,
  geoPointValue,
  literalToValue,
  mapValue,
  missingValue,
  numberScalar,
  stringScalar,
  stringValue,
  timestampValue,
  toFdqlValue,
  truthyValue,
} from './value.ts';

export interface EvalContext {
  readonly aliases?: Readonly<Record<string, FdqlValue>> | undefined;
  readonly providers?: FdqlProviderDialectRegistry | undefined;
  readonly rows?: EvalRows | undefined;
}

export function evaluateExpression(
  expression: FdqlExpression,
  context: EvalContext = {},
): FdqlValue {
  switch (expression.kind) {
    case 'literal':
      return literalToValue(expression.value);
    case 'alias':
      return context.aliases?.[expression.name] ?? missingValue;
    case 'array':
      return arrayValue(expression.items.map((item) => evaluateExpression(item, context)));
    case 'map':
      return mapValue(Object.fromEntries(
        expression.entries.map((entry) => [entry.key, evaluateExpression(entry.value, context)]),
      ));
    case 'field':
      return evaluateField(expression.path, context);
    case 'call':
      return evaluateCall(expression.name, expression.args, context);
    case 'unary':
      return booleanValue(!truthy(evaluateExpression(expression.expression, context)));
    case 'binary':
      return booleanValue(evaluateBinary(expression, context));
    case 'wildcard':
      return mapValue({});
  }
}

export function truthy(value: unknown): boolean {
  return truthyValue(toFdqlValue(value));
}

function evaluateField(
  path: readonly string[],
  context: EvalContext,
): FdqlValue {
  const root = context.rows?.[path[0] ?? ''];
  if (root === null || root === undefined) return missingValue;
  if (path.length === 1) {
    if (isDocument(root)) return mapValue(root.data);
    if (Array.isArray(root)) {
      return arrayValue(
        root.map((item) => isDocument(item) ? mapValue(item.data) : toFdqlValue(item)),
      );
    }
    if (isFdqlRowMap(root)) return mapValue(root);
    if (isFdqlValue(root)) return root;
  }
  const data = isDocument(root)
    ? mapValue(root.data)
    : isFdqlValue(root)
    ? root
    : Array.isArray(root)
    ? arrayValue(root.map((item) => isDocument(item) ? mapValue(item.data) : toFdqlValue(item)))
    : mapValue(root);
  return path.slice(1).reduce<FdqlValue>((current, segment) => {
    if (!isFdqlValue(current)) return missingValue;
    if (current.kind !== 'map') return missingValue;
    return current.value[segment] ?? missingValue;
  }, data);
}

function evaluateCall(
  name: string,
  args: readonly FdqlExpression[],
  context: EvalContext,
): FdqlValue {
  const provider = providerNamespaceFromCall(name);
  if (provider) {
    return context.providers?.[provider]?.evaluateCall?.({
      args,
      context,
      evaluate: evaluateExpression,
      name,
    }) ?? missingValue;
  }
  if (name === 'timestamp') {
    return timestampValue(stringScalar(evaluateExpression(args[0]!, context)) ?? '');
  }
  if (name === 'bytes') {
    return bytesValue(
      (stringScalar(evaluateExpression(args[0]!, context)) ?? '').replace(/^base64:/, ''),
    );
  }
  if (name === 'geoPoint') {
    return geoPointValue(
      numberScalar(evaluateExpression(args[0]!, context)) ?? 0,
      numberScalar(evaluateExpression(args[1]!, context)) ?? 0,
    );
  }
  if (name === 'lower') {
    const value = evaluateExpression(args[0]!, context);
    return value.kind === 'string' ? stringValue(value.value.toLowerCase()) : value;
  }
  if (name === 'entries') {
    const value = evaluateExpression(args[0]!, context);
    if (value.kind !== 'map') return arrayValue([]);
    return arrayValue(
      Object.entries(value.value).map(([key, entryValue]) =>
        mapValue({ key: stringValue(key), value: entryValue })
      ),
    );
  }
  if (name === 'mapGet') {
    const map = evaluateExpression(args[0]!, context);
    const key = evaluateExpression(args[1]!, context);
    if (map.kind !== 'map' || (key.kind !== 'string' && key.kind !== 'number')) return missingValue;
    return map.value[String(key.value)] ?? missingValue;
  }
  return missingValue;
}

function evaluateBinary(
  expression: Extract<FdqlExpression, { readonly kind: 'binary'; }>,
  context: EvalContext,
): boolean {
  if (expression.operator === 'and') {
    return truthy(evaluateExpression(expression.left, context))
      && truthy(evaluateExpression(expression.right, context));
  }
  if (expression.operator === 'or') {
    return truthy(evaluateExpression(expression.left, context))
      || truthy(evaluateExpression(expression.right, context));
  }
  const left = evaluateExpression(expression.left, context);
  const right = evaluateExpression(expression.right, context);
  switch (expression.operator) {
    case '=':
      return equalValues(left, right);
    case '!=':
      return !equalValues(left, right);
    case '<':
      return compare(left, right) < 0;
    case '<=':
      return compare(left, right) <= 0;
    case '>':
      return compare(left, right) > 0;
    case '>=':
      return compare(left, right) >= 0;
    case 'in':
      return right.kind === 'array' && right.value.some((item) => equalValues(item, left));
    default:
      return false;
  }
}

function compare(left: FdqlValue, right: FdqlValue): number {
  return compareValues(left, right);
}

function isDocument(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'id' in value
    && 'data' in value
    && 'provider' in value;
}

function isFdqlValue(value: unknown): value is FdqlValue {
  return value !== null
    && typeof value === 'object'
    && 'kind' in value;
}

function isFdqlRowMap(value: unknown): value is Record<string, FdqlValue> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !isDocument(value)
    && !isFdqlValue(value);
}
