import { evaluateExpression, truthy } from '../evaluator.ts';
import {
  createProviderDialectRegistry,
  type FdqlProviderDialect,
  type FdqlProviderRuntimeRegistry,
} from '../provider.ts';
import type { FdqlDiagnostic, FdqlExpression, FdqlProviderRow } from '../types.ts';

export const testProviderDialect: FdqlProviderDialect = {
  namespace: 'mem',
  sourceFunctions: new Set(['collection']),
  valueFunctions: new Set(['mem.id', 'mem.path']),
  evaluateCall(input) {
    if (input.name === 'mem.id') return rowArg(input.args[0], input.context)?.id;
    if (input.name === 'mem.path') return rowArg(input.args[0], input.context)?.path;
    return undefined;
  },
  hasBoundedPredicate() {
    return false;
  },
  resolveSourceAlias(input) {
    const { declaration, diagnostics } = input;
    if (declaration.value.kind !== 'call' || !declaration.value.name.startsWith('mem.')) {
      return null;
    }
    const parts = declaration.value.name.split('.').slice(1);
    if (parts.length !== 1 || parts[0] !== 'collection') {
      diagnostics.push(
        error('FDQL_UNKNOWN_NAMESPACE', 'Unknown mem source function.', declaration.line),
      );
      return null;
    }
    const expression = declaration.value.args[0];
    if (expression?.kind !== 'literal' || typeof expression.value !== 'string') {
      diagnostics.push(
        error('FDQL_PARSE_ERROR', 'mem.collection needs a string argument.', declaration.line),
      );
      return null;
    }
    return {
      kind: 'source',
      source: {
        provider: 'mem',
        sourceAlias: declaration.name,
        sourceType: 'collection',
        target: { collection: expression.value },
      },
    };
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
            data,
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
