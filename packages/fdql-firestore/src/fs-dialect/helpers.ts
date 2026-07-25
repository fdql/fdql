import {
  arrayValue,
  evaluateExpression,
  type FdqlDiagnostic,
  type FdqlExpression,
  type FdqlProviderEvaluationContext,
  type FdqlProviderRow,
  type FdqlProviderSourceResolveInput,
  type FdqlValue,
  literalToValue,
  mapValue,
  missingValue,
  stringScalar,
} from '@firebase-desk/fdql-core';

export function firestoreError(
  code: string,
  message: string,
  line?: number,
): FdqlDiagnostic {
  return { code, ...(line ? { line } : {}), message, severity: 'error' };
}

export function stringContextValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function stringArg(
  expression: FdqlExpression | undefined,
  aliases: FdqlProviderSourceResolveInput['aliases'],
): string | undefined {
  if (!expression) return undefined;
  const value = evaluateAliasValue(expression, aliases);
  return stringScalar(value) ?? undefined;
}

export function sourceTargetString(
  source: { readonly target: Readonly<Record<string, unknown>>; },
  key: string,
): string {
  const value = source.target[key];
  return typeof value === 'string' ? value : '';
}

export function readStringArg(
  expression: FdqlExpression | undefined,
  input: FdqlProviderSourceResolveInput,
  functionName: string,
): string {
  if (!expression) {
    input.diagnostics.push(
      firestoreError(
        'FDQL_PARSE_ERROR',
        `${functionName} needs a string argument.`,
        input.declaration.line,
      ),
    );
    return '';
  }
  const value = evaluateAliasValue(expression, input.aliases);
  const text = stringScalar(value);
  if (text === undefined) {
    input.diagnostics.push(
      firestoreError(
        'FDQL_PARSE_ERROR',
        `${functionName} needs a string argument.`,
        input.declaration.line,
      ),
    );
    return '';
  }
  return text;
}

export function validateDocumentPath(
  path: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  const segments = path.split('/');
  if (
    segments.length === 0 || segments.length % 2 !== 0
    || segments.some((segment) => segment.length === 0)
  ) {
    diagnostics.push(
      firestoreError('FDQL_PARSE_ERROR', `Invalid document path ${path}.`, line),
    );
  }
}

export function validateCollectionId(
  collectionId: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (!collectionId || collectionId.includes('/')) {
    diagnostics.push(
      firestoreError('FDQL_PARSE_ERROR', 'Subcollection name must be one collection id.', line),
    );
  }
}

export function evaluateAliasValue(
  expression: FdqlExpression,
  aliases: FdqlProviderSourceResolveInput['aliases'],
): FdqlValue {
  if (expression.kind === 'alias') {
    const value = aliases[expression.name];
    return value?.kind === 'value' ? value.value : missingValue;
  }
  if (expression.kind === 'array') {
    return arrayValue(expression.items.map((item) => evaluateAliasValue(item, aliases)));
  }
  if (expression.kind === 'map') {
    return mapValue(Object.fromEntries(
      expression.entries.map((entry) => [entry.key, evaluateAliasValue(entry.value, aliases)]),
    ));
  }
  if (expression.kind === 'literal') return literalToValue(expression.value);
  return evaluateExpression(expression);
}

export function rowArg(
  expression: FdqlExpression | undefined,
  context: FdqlProviderEvaluationContext,
): unknown {
  if (!expression || expression.kind !== 'field' || expression.path.length !== 1) return undefined;
  return context.rows?.[expression.path[0] ?? ''];
}

export function isCollectionPath(path: string): boolean {
  return Boolean(path) && path.split('/').filter(Boolean).length % 2 === 1;
}

export function isProviderRow(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'data' in value
    && 'id' in value
    && 'provider' in value;
}

export function walkExpression(
  expression: FdqlExpression,
  visit: (expression: FdqlExpression, parent?: FdqlExpression | undefined) => void,
  parent?: FdqlExpression,
): void {
  visit(expression, parent);
  if (expression.kind === 'array') {
    for (const item of expression.items) walkExpression(item, visit, expression);
  } else if (expression.kind === 'map') {
    for (const entry of expression.entries) walkExpression(entry.value, visit, expression);
  } else if (expression.kind === 'call') {
    for (const arg of expression.args) walkExpression(arg, visit, expression);
  } else if (expression.kind === 'case') {
    for (const branch of expression.branches) {
      walkExpression(branch.condition, visit, expression);
      walkExpression(branch.value, visit, expression);
    }
    if (expression.elseExpression) walkExpression(expression.elseExpression, visit, expression);
  } else if (expression.kind === 'unary') {
    walkExpression(expression.expression, visit, expression);
  } else if (expression.kind === 'postfix') {
    walkExpression(expression.expression, visit, expression);
  } else if (expression.kind === 'binary') {
    walkExpression(expression.left, visit, expression);
    walkExpression(expression.right, visit, expression);
  }
}
