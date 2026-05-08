import { type FdqlProviderDialectRegistry, providerNamespaceFromCall } from '../provider.ts';
import type {
  FdqlDiagnostic,
  FdqlProjectionItem,
  FdqlProviderAggregateItem,
  FdqlValue,
} from '../types.ts';
import { compilerError } from './diagnostics.ts';
import { validateExpressionAliases } from './expression-validation.ts';

export function compileProviderAggregateItems(input: {
  readonly diagnostics: FdqlDiagnostic[];
  readonly line: number;
  readonly missingYieldCode?: string | undefined;
  readonly providerRowAlias?: string | undefined;
  readonly providers: FdqlProviderDialectRegistry;
  readonly scalarAliases: Readonly<Record<string, FdqlValue>>;
  readonly sourceProvider: string;
  readonly yieldItems?: readonly FdqlProjectionItem[] | undefined;
}): readonly FdqlProviderAggregateItem[] {
  if (!input.yieldItems?.length) {
    input.diagnostics.push(
      compilerError(
        input.missingYieldCode ?? 'FDQL_MISSING_PROVIDER_AGGREGATE_YIELD',
        'Provider aggregate needs one `yield` projection.',
        input.line,
      ),
    );
    return [];
  }
  const sourceDialect = input.providers[input.sourceProvider];
  const aliases = new Set<string>();
  const aggregates: FdqlProviderAggregateItem[] = [];
  for (const item of input.yieldItems) {
    const alias = item.alias;
    if (!alias) {
      input.diagnostics.push(
        compilerError(
          'FDQL_INVALID_PROVIDER_AGGREGATE_YIELD',
          'Provider aggregate yield expressions need `as alias`.',
          item.line ?? input.line,
        ),
      );
      continue;
    }
    if (aliases.has(alias)) {
      input.diagnostics.push(
        compilerError(
          'FDQL_DUPLICATE_YIELD_ALIAS',
          `Duplicate aggregate yield alias ${alias}.`,
          item.line ?? input.line,
        ),
      );
      continue;
    }
    aliases.add(alias);
    if (item.expression.kind !== 'call') {
      input.diagnostics.push(
        compilerError(
          'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE',
          'Provider aggregate yield expressions must use provider aggregate functions.',
          item.line ?? input.line,
        ),
      );
      continue;
    }
    const functionProvider = providerNamespaceFromCall(item.expression.name);
    if (functionProvider !== input.sourceProvider) {
      input.diagnostics.push(
        compilerError(
          'FDQL_PROVIDER_MISMATCH',
          `Aggregate function ${item.expression.name} does not match source provider ${input.sourceProvider}.`,
          item.line ?? input.line,
        ),
      );
      continue;
    }
    if (!sourceDialect?.aggregateFunctions?.has(item.expression.name)) {
      input.diagnostics.push(
        compilerError(
          'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE',
          `Unsupported provider aggregate function ${item.expression.name}.`,
          item.line ?? input.line,
        ),
      );
      continue;
    }
    if (!input.providerRowAlias && item.expression.name !== `${input.sourceProvider}.count`) {
      input.diagnostics.push(
        compilerError(
          'FDQL_INVALID_PROVIDER_AGGREGATE',
          'Provider aggregate field functions need a source row alias.',
          item.line ?? input.line,
        ),
      );
      continue;
    }
    for (const arg of item.expression.args) {
      validateExpressionAliases(
        arg,
        input.scalarAliases,
        input.providers,
        input.diagnostics,
        item.line ?? input.line,
      );
    }
    sourceDialect.validateAggregate?.({
      diagnostics: input.diagnostics,
      expression: item.expression,
      functionName: item.expression.name,
      line: item.line ?? input.line,
      rowAlias: input.providerRowAlias ?? '__aggregate',
    });
    aggregates.push({
      alias,
      ...(item.expression.args[0] ? { expression: item.expression.args[0] } : {}),
      functionName: item.expression.name,
    });
  }
  return aggregates;
}
