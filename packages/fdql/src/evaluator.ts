import type { EvalRows, FdqlExpression, FdqlRuntimeDocument, FdqlValue } from './types.ts';

export interface EvalContext {
  readonly aliases?: Readonly<Record<string, FdqlValue>> | undefined;
  readonly rows?: EvalRows | undefined;
}

export function evaluateExpression(expression: FdqlExpression, context: EvalContext = {}): unknown {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'alias':
      return context.aliases?.[expression.name];
    case 'array':
      return expression.items.map((item) => evaluateExpression(item, context));
    case 'map':
      return Object.fromEntries(
        expression.entries.map((entry) => [entry.key, evaluateExpression(entry.value, context)]),
      );
    case 'field':
      return evaluateField(expression.path, context);
    case 'call':
      return evaluateCall(expression.name, expression.args, context);
    case 'unary':
      return !truthy(evaluateExpression(expression.expression, context));
    case 'binary':
      return evaluateBinary(expression, context);
    case 'wildcard':
      return context.rows ?? {};
  }
}

export function truthy(value: unknown): boolean {
  return Boolean(value);
}

function evaluateField(
  path: readonly string[],
  context: EvalContext,
): unknown {
  const root = context.rows?.[path[0] ?? ''];
  if (root === null || root === undefined) return undefined;
  const data = isDocument(root) ? root.data : root;
  return path.slice(1).reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, data);
}

function evaluateCall(
  name: string,
  args: readonly FdqlExpression[],
  context: EvalContext,
): unknown {
  if (name === 'fs.id') {
    const row = rowArg(args[0], context);
    return isDocument(row) ? row.id : undefined;
  }
  if (name === 'fs.path') {
    const row = rowArg(args[0], context);
    return isDocument(row) ? row.path : undefined;
  }
  if (name === 'fs.projectId') {
    const row = rowArg(args[0], context);
    return isDocument(row) ? row.projectId : undefined;
  }
  if (name === 'fs.timestamp') return evaluateExpression(args[0]!, context);
  if (name === 'fs.arrayContains') {
    const array = evaluateExpression(args[0]!, context);
    const value = evaluateExpression(args[1]!, context);
    return Array.isArray(array) && array.some((item) => Object.is(item, value));
  }
  if (name === 'lower') {
    const value = evaluateExpression(args[0]!, context);
    return typeof value === 'string' ? value.toLowerCase() : value;
  }
  if (name === 'entries') {
    const value = evaluateExpression(args[0]!, context);
    if (!isPlainRecord(value)) return [];
    return Object.entries(value).map(([key, entryValue]) => ({ key, value: entryValue }));
  }
  if (name === 'mapGet') {
    const map = evaluateExpression(args[0]!, context);
    const key = evaluateExpression(args[1]!, context);
    if (!isPlainRecord(map) || (typeof key !== 'string' && typeof key !== 'number')) return null;
    return map[String(key)] ?? null;
  }
  return undefined;
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
      return Object.is(left, right);
    case '!=':
      return !Object.is(left, right);
    case '<':
      return compare(left, right) < 0;
    case '<=':
      return compare(left, right) <= 0;
    case '>':
      return compare(left, right) > 0;
    case '>=':
      return compare(left, right) >= 0;
    case 'in':
      return Array.isArray(right) && right.some((item) => Object.is(item, left));
    default:
      return false;
  }
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function rowArg(
  expression: FdqlExpression | undefined,
  context: EvalContext,
): FdqlRuntimeDocument | Record<string, unknown> | null | undefined {
  if (!expression || expression.kind !== 'field' || expression.path.length !== 1) return undefined;
  return context.rows?.[expression.path[0] ?? ''];
}

function isDocument(value: unknown): value is FdqlRuntimeDocument {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'id' in value
    && 'data' in value
    && 'projectId' in value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && !Array.isArray(value)
    && !isDocument(value);
}
