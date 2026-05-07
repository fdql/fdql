import type {
  FdqlDefaultProviderContext,
  FdqlProviderDialectRegistry,
  FdqlProviderSourceAlias,
} from '../provider.ts';
import { providerNamespaceFromCall } from '../provider.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlLookupPlanStage,
  FdqlLookupStage,
  FdqlProviderOrderByClause,
  FdqlValue,
} from '../types.ts';
import type { ResolvedAliasValue } from './aliases.ts';
import { compilerError, duplicateStage } from './diagnostics.ts';
import { validateExpressionAliases, validateStageProvider } from './expression-validation.ts';
import { parseCacheTtlMs } from './settings.ts';

export function compileLookupStage(
  stage: FdqlLookupStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  availableRowAliases: ReadonlySet<string>,
  scalarAliases: Readonly<Record<string, FdqlValue>>,
  providerContext: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlLookupPlanStage | null {
  const sourceAlias = resolveLookupSource(
    stage,
    aliases,
    availableRowAliases,
    providerContext,
    providers,
    diagnostics,
  );
  if (!sourceAlias) return null;
  if (stage.required && stage.mode !== 'one') {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_REQUIRED',
        '`lookup required` is only valid with `one`.',
        stage.line,
      ),
    );
    return null;
  }

  const sourceProvider = sourceAlias.source.provider;
  const sourceDialect = providers[sourceProvider];
  const cacheTtlMs = resolveLookupCacheTtl(stage, diagnostics);
  let providerPredicate: FdqlExpression | undefined;
  let providerOrderBy: FdqlProviderOrderByClause | undefined;
  let providerOrderByLine: number | undefined;
  let providerLimit: number | undefined;
  let providerLimitLine: number | undefined;
  const rowsForLookup = new Set([...availableRowAliases, stage.rowAlias]);

  for (const clause of stage.clauses) {
    if (
      !validateStageProvider(clause.provider, sourceProvider, providers, diagnostics, clause.line)
    ) {
      continue;
    }
    if (clause.kind === 'providerWhere') {
      validateExpressionAliases(
        clause.expression,
        scalarAliases,
        providers,
        diagnostics,
        clause.line,
      );
      sourceDialect?.validateWhere({
        aliases: scalarAliases,
        availableRowAliases: rowsForLookup,
        diagnostics,
        expression: clause.expression,
        line: clause.line,
        lookup: true,
        rowAlias: stage.rowAlias,
      });
      providerPredicate = providerPredicate
        ? { kind: 'binary', left: providerPredicate, operator: 'and', right: clause.expression }
        : clause.expression;
    } else if (clause.kind === 'providerOrderBy') {
      if (providerOrderByLine !== undefined) {
        diagnostics.push(
          duplicateStage(`lookup ${clause.provider} order by`, providerOrderByLine, clause.line),
        );
        continue;
      }
      validateExpressionAliases(
        clause.expression,
        scalarAliases,
        providers,
        diagnostics,
        clause.line,
      );
      sourceDialect?.validateOrderBy({
        diagnostics,
        expression: clause.expression,
        line: clause.line,
        rowAlias: stage.rowAlias,
      });
      providerOrderBy = { direction: clause.direction, expression: clause.expression };
      providerOrderByLine = clause.line;
    } else if (clause.kind === 'providerLimit') {
      if (providerLimitLine !== undefined) {
        diagnostics.push(
          duplicateStage(`lookup ${clause.provider} limit`, providerLimitLine, clause.line),
        );
        continue;
      }
      if (!Number.isInteger(clause.value) || clause.value <= 0) {
        diagnostics.push(
          compilerError(
            'FDQL_PARSE_ERROR',
            `\`${clause.provider} limit\` must be a positive integer.`,
            clause.line,
          ),
        );
      }
      providerLimit = clause.value;
      providerLimitLine = clause.line;
    }
  }

  return {
    ...(stage.cache ? { cache: stage.cache } : {}),
    ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
    column: stage.column,
    kind: 'lookup',
    line: stage.line,
    mode: stage.mode,
    provider: {
      ...(sourceAlias.binding ? { binding: sourceAlias.binding } : {}),
      ...(sourceAlias.fieldMask ? { fieldMask: sourceAlias.fieldMask } : {}),
      ...(providerLimit === undefined ? {} : { limit: providerLimit }),
      ...(providerOrderBy ? { orderBy: providerOrderBy } : {}),
      ...(providerPredicate ? { predicate: providerPredicate } : {}),
      source: sourceAlias.source,
    },
    range: stage.range,
    required: stage.required,
    rowAlias: stage.rowAlias,
    sourceAlias: stage.sourceAlias,
  };
}

function resolveLookupSource(
  stage: FdqlLookupStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  availableRowAliases: ReadonlySet<string>,
  providerContext: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const sourceAlias = stage.sourceExpression
    ? resolveLookupSourceExpression(
      stage,
      aliases,
      availableRowAliases,
      providerContext,
      providers,
      diagnostics,
    )
    : resolveLookupSourceAlias(stage, aliases, diagnostics);
  if (!sourceAlias) return null;
  return applyLookupParent(stage, sourceAlias, availableRowAliases, diagnostics);
}

function resolveLookupSourceAlias(
  stage: FdqlLookupStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const sourceAlias = aliases[stage.sourceAlias];
  if (!sourceAlias) {
    diagnostics.push(
      compilerError(
        'FDQL_UNDECLARED_ALIAS',
        `Source alias ${stage.sourceAlias} is not declared.`,
        stage.line,
      ),
    );
    return null;
  }
  if (sourceAlias.kind !== 'source') {
    diagnostics.push(
      compilerError(
        'FDQL_UNDECLARED_ALIAS',
        `Alias ${stage.sourceAlias} is not a provider source.`,
        stage.line,
      ),
    );
    return null;
  }
  return sourceAlias;
}

function resolveLookupSourceExpression(
  stage: FdqlLookupStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  availableRowAliases: ReadonlySet<string>,
  providerContext: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const expression = stage.sourceExpression;
  if (!expression || expression.kind !== 'call') {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_SOURCE',
        'Lookup source must be a source alias or provider source call.',
        stage.line,
      ),
    );
    return null;
  }
  const namespace = providerNamespaceFromCall(expression.name);
  if (!namespace) {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_SOURCE',
        'Lookup source must be a provider source call.',
        stage.line,
      ),
    );
    return null;
  }
  const provider = providers[namespace];
  if (!provider) {
    diagnostics.push(
      compilerError(
        'FDQL_UNKNOWN_NAMESPACE',
        `Unknown provider namespace ${namespace}.`,
        stage.line,
      ),
    );
    return null;
  }
  if (!provider.resolveSourceExpression) {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_SOURCE',
        `Provider ${namespace} does not support inline lookup sources.`,
        stage.line,
      ),
    );
    return null;
  }
  return provider.resolveSourceExpression({
    aliases,
    availableRowAliases,
    defaultProviderContext: providerContext,
    diagnostics,
    expression,
    line: stage.line,
    sourceAlias: stage.sourceAlias,
  });
}

function applyLookupParent(
  stage: FdqlLookupStage,
  sourceAlias: FdqlProviderSourceAlias,
  availableRowAliases: ReadonlySet<string>,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const binding = sourceAlias.binding;
  if (stage.parent) {
    if (!binding || binding.kind !== 'parent') {
      diagnostics.push(
        compilerError(
          'FDQL_INVALID_LOOKUP_PARENT',
          '`of parent` is only valid with a parent-bound subcollection source.',
          stage.line,
        ),
      );
      return null;
    }
    if (binding.expression) {
      diagnostics.push(
        compilerError(
          'FDQL_INVALID_LOOKUP_PARENT',
          '`of parent` is invalid because the lookup source already has a parent.',
          stage.line,
        ),
      );
      return null;
    }
    validateParentExpression(stage.parent, availableRowAliases, diagnostics, stage.line);
    return { ...sourceAlias, binding: { kind: 'parent', expression: stage.parent } };
  }
  if (binding?.kind === 'parent' && !binding.expression) {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_PARENT',
        `Subcollection source ${stage.sourceAlias} needs \`of parent\` in lookup.`,
        stage.line,
      ),
    );
    return null;
  }
  if (binding?.kind === 'parent' && binding.expression) {
    validateParentExpression(binding.expression, availableRowAliases, diagnostics, stage.line);
  }
  return sourceAlias;
}

function validateParentExpression(
  expression: FdqlExpression,
  availableRowAliases: ReadonlySet<string>,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (
    expression.kind === 'field' && expression.path.length === 1
    && availableRowAliases.has(expression.path[0] ?? '')
  ) {
    return;
  }
  diagnostics.push(
    compilerError(
      'FDQL_INVALID_LOOKUP_PARENT',
      'Subcollection parent must be an existing provider row alias.',
      line,
    ),
  );
}

function resolveLookupCacheTtl(
  stage: FdqlLookupStage,
  diagnostics: FdqlDiagnostic[],
): number | undefined {
  if (!stage.cacheTtlRaw) return undefined;
  if (stage.cache !== 'persistent') {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_CACHE',
        'Lookup cache TTL is only valid with `cache persistent`.',
        stage.line,
      ),
    );
    return undefined;
  }
  const cacheTtlMs = parseCacheTtlMs(stage.cacheTtlRaw);
  if (!cacheTtlMs) {
    diagnostics.push(
      compilerError('FDQL_INVALID_LOOKUP_CACHE', 'Invalid lookup cache TTL.', stage.line),
    );
  }
  return cacheTtlMs;
}
