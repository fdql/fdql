import { evaluateExpression, truthy } from '../evaluator.ts';
import {
  createProviderDialectRegistry,
  type FdqlProviderDialect,
  type FdqlProviderRuntimeRegistry,
} from '../provider.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlFieldMaskField,
  FdqlProviderRow,
} from '../types.ts';
import { missingValue, stringValue, toFdqlValue } from '../value.ts';

export const testProviderDialect: FdqlProviderDialect = {
  namespace: 'mem',
  sourceFunctions: new Set(['child', 'collection']),
  valueFunctions: new Set(['mem.id', 'mem.path']),
  bindSource(input) {
    if (input.binding.kind !== 'parent') return { kind: 'bound', source: input.source };
    const parent = rowArg(input.binding.expression, input.context);
    if (!parent) return { kind: 'skip' };
    const childCollection = String(input.source.target.collection ?? '');
    return {
      kind: 'bound',
      source: {
        ...input.source,
        target: {
          ...input.source.target,
          collection: `${parent.path}/${childCollection}`,
          parentPath: parent.path,
        },
      },
    };
  },
  evaluateCall(input) {
    if (input.name === 'mem.id') {
      const row = rowArg(input.args[0], input.context);
      return row ? stringValue(row.id) : missingValue;
    }
    if (input.name === 'mem.path') {
      const row = rowArg(input.args[0], input.context);
      return row ? stringValue(row.path) : missingValue;
    }
    return missingValue;
  },
  hasBoundedPredicate() {
    return false;
  },
  resolveSourceAlias(input) {
    return resolveSourceCall({
      diagnostics: input.diagnostics,
      expression: input.declaration.value,
      line: input.declaration.line,
      sourceAlias: input.declaration.name,
    });
  },
  resolveSourceExpression(input) {
    return resolveSourceCall({
      diagnostics: input.diagnostics,
      expression: input.expression,
      line: input.line,
      sourceAlias: input.sourceAlias,
    });
  },
  validateOrderBy(input) {
    if (input.expression.kind === 'field' && input.expression.path[0] === input.rowAlias) return;
    if (input.expression.kind === 'call' && input.expression.name === 'mem.id') return;
    input.diagnostics.push(
      error(
        'FDQL_UNSUPPORTED_PROVIDER_ORDER_BY',
        '`mem order by` needs a provider field.',
        input.line,
      ),
    );
  },
  validateWhere(input) {
    validatePredicate(input.expression, input.rowAlias, input.diagnostics, input.line);
  },
};

function resolveSourceCall(input: {
  readonly diagnostics: FdqlDiagnostic[];
  readonly expression: FdqlExpression;
  readonly line: number;
  readonly sourceAlias: string;
}) {
  const { diagnostics, expression, line, sourceAlias } = input;
  if (expression.kind !== 'call' || !expression.name.startsWith('mem.')) return null;
  const parts = expression.name.split('.').slice(1);
  if (parts.length !== 1) {
    diagnostics.push(error('FDQL_UNKNOWN_NAMESPACE', 'Unknown mem source function.', line));
    return null;
  }
  if (parts[0] === 'collection') {
    return resolveCollectionCall(expression, diagnostics, line, sourceAlias);
  }
  if (parts[0] === 'child') return resolveChildCall(expression, diagnostics, line, sourceAlias);
  diagnostics.push(error('FDQL_UNKNOWN_NAMESPACE', 'Unknown mem source function.', line));
  return null;
}

function resolveCollectionCall(
  expression: Extract<FdqlExpression, { readonly kind: 'call'; }>,
  diagnostics: FdqlDiagnostic[],
  line: number,
  sourceAlias: string,
) {
  const collection = stringLiteral(expression.args[0]);
  if (!collection) {
    diagnostics.push(error('FDQL_PARSE_ERROR', 'mem.collection needs a string argument.', line));
    return null;
  }
  return {
    ...fieldMaskFromExpression(expression.args[1]),
    kind: 'source' as const,
    source: {
      provider: 'mem',
      sourceAlias,
      sourceType: 'collection',
      target: { collection },
    },
  };
}

function resolveChildCall(
  expression: Extract<FdqlExpression, { readonly kind: 'call'; }>,
  diagnostics: FdqlDiagnostic[],
  line: number,
  sourceAlias: string,
) {
  const first = expression.args[0];
  const second = expression.args[1];
  const templateCollection = stringLiteral(first);
  if (templateCollection && expression.args.length <= 2) {
    return {
      ...fieldMaskFromExpression(second),
      binding: { kind: 'parent' as const },
      kind: 'source' as const,
      source: {
        provider: 'mem',
        sourceAlias,
        sourceType: 'child',
        target: { collection: templateCollection },
      },
    };
  }
  const collection = stringLiteral(second);
  if (!first || !collection) {
    diagnostics.push(
      error('FDQL_PARSE_ERROR', 'mem.child needs parent and collection arguments.', line),
    );
    return null;
  }
  return {
    ...fieldMaskFromExpression(expression.args[2]),
    binding: { expression: first, kind: 'parent' as const },
    kind: 'source' as const,
    source: {
      provider: 'mem',
      sourceAlias,
      sourceType: 'child',
      target: { collection },
    },
  };
}

function stringLiteral(expression: FdqlExpression | undefined): string | null {
  return expression?.kind === 'literal' && typeof expression.value === 'string'
    ? expression.value
    : null;
}

function fieldMaskFromExpression(
  expression: FdqlExpression | undefined,
): { readonly fieldMask: readonly FdqlFieldMaskField[]; } | null {
  if (!expression) return null;
  if (expression.kind !== 'array') return null;
  return {
    fieldMask: expression.items.flatMap((item) =>
      item.kind === 'literal' && typeof item.value === 'string'
        ? [{ segments: item.value.split('.') }]
        : []
    ),
  };
}

export function createTestProviderRuntime(
  collections: Readonly<Record<string, Readonly<Record<string, Record<string, unknown>>>>>,
): FdqlProviderRuntimeRegistry {
  const dialects = createProviderDialectRegistry([testProviderDialect]);
  return {
    dialects,
    providers: {
      mem: {
        async *read(request) {
          const collection = String(request.source.target.collection ?? '');
          const docs = Object.entries(collections[collection] ?? {}).map(([id, data]) => ({
            context: { collection },
            data: Object.fromEntries(
              Object.entries(data).map(([key, value]) => [key, toFdqlValue(value)]),
            ),
            id,
            path: `${collection}/${id}`,
            provider: 'mem',
            source: request.source,
          }));
          const filtered = docs.filter((row) =>
            !request.predicate
            || truthy(evaluateExpression(request.predicate, {
              aliases: request.aliases,
              providers: dialects,
              rows: { ...request.rows, [request.rowAlias]: row },
            }))
          );
          for (const row of filtered.slice(0, request.maxDocuments)) yield row;
        },
      },
    },
  };
}

function validatePredicate(
  expression: FdqlExpression,
  rowAlias: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (
    expression.kind === 'binary' && (expression.operator === 'and' || expression.operator === 'or')
  ) {
    validatePredicate(expression.left, rowAlias, diagnostics, line);
    validatePredicate(expression.right, rowAlias, diagnostics, line);
    return;
  }
  if (
    expression.kind !== 'binary' || expression.left.kind !== 'field'
    || expression.left.path[0] !== rowAlias
  ) {
    diagnostics.push(
      error(
        'FDQL_UNSUPPORTED_PROVIDER_WHERE',
        '`mem where` needs a provider field on the left.',
        line,
      ),
    );
  }
}

function rowArg(
  expression: FdqlExpression | undefined,
  context: Parameters<NonNullable<FdqlProviderDialect['evaluateCall']>>[0]['context'],
): FdqlProviderRow | undefined {
  if (!expression || expression.kind !== 'field' || expression.path.length !== 1) return undefined;
  const row = context.rows?.[expression.path[0] ?? ''];
  return isProviderRow(row) ? row : undefined;
}

function isProviderRow(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'data' in value
    && 'id' in value
    && 'provider' in value;
}

function error(code: string, message: string, line?: number): FdqlDiagnostic {
  return { code, ...(line ? { line } : {}), message, severity: 'error' };
}
