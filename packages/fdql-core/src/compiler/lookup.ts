import type { FdqlDefaultProviderContext, FdqlProviderDialectRegistry } from '../provider.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlLookupPlanStage,
  FdqlLookupStage,
  FdqlProviderOrderByClause,
  FdqlValue,
} from '../types.ts';
import type { ResolvedAliasValue } from './aliases.ts';
import { diagnosticAtRange, duplicateStage } from './diagnostics.ts';
import { validateExpressionAliases, validateStageProvider } from './expression-validation.ts';
import { resolveProviderStageSource } from './provider-source.ts';
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
  const sourceAlias = resolveProviderStageSource(
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
      diagnosticAtRange(
        'FDQL_INVALID_LOOKUP_REQUIRED',
        '`lookup required` is only valid with `one`.',
        stage.range,
      ),
    );
    return null;
  }

  const sourceProvider = sourceAlias.source.provider;
  const sourceDialect = providers[sourceProvider];
  const cacheTtlMs = resolveLookupCacheTtl(stage, diagnostics);
  let providerPredicate: FdqlExpression | undefined;
  let providerPredicateLine: number | undefined;
  let providerOrderBy: FdqlProviderOrderByClause | undefined;
  let providerOrderByLine: number | undefined;
  let providerLimit: number | undefined;
  let providerLimitLine: number | undefined;
  const rowsForLookup = new Set([...availableRowAliases, stage.rowAlias]);

  for (const clause of stage.clauses) {
    if (
      !validateStageProvider(
        clause.provider,
        sourceProvider,
        providers,
        diagnostics,
        clause.line,
        clause.providerRef?.range,
      )
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
      providerPredicateLine ??= clause.line;
    } else if (clause.kind === 'providerOrderBy') {
      if (providerOrderByLine !== undefined) {
        diagnostics.push(
          duplicateStage(
            `lookup ${clause.provider} order by`,
            providerOrderByLine,
            clause.line,
            clause.providerRef?.range,
          ),
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
          duplicateStage(
            `lookup ${clause.provider} limit`,
            providerLimitLine,
            clause.line,
            clause.providerRef?.range,
          ),
        );
        continue;
      }
      if (!Number.isInteger(clause.value) || clause.value <= 0) {
        diagnostics.push(
          diagnosticAtRange(
            'FDQL_PARSE_ERROR',
            `\`${clause.provider} limit\` must be a positive integer.`,
            clause.range,
          ),
        );
      }
      providerLimit = clause.value;
      providerLimitLine = clause.line;
    }
  }

  sourceDialect?.validateQuery?.({
    aliases: scalarAliases,
    availableRowAliases: rowsForLookup,
    diagnostics,
    lookup: true,
    ...(providerOrderBy ? { orderBy: providerOrderBy } : {}),
    ...(providerOrderByLine === undefined ? {} : { orderByLine: providerOrderByLine }),
    ...(providerPredicate ? { predicate: providerPredicate } : {}),
    ...(providerPredicateLine === undefined ? {} : { predicateLine: providerPredicateLine }),
    rowAlias: stage.rowAlias,
  });

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

function resolveLookupCacheTtl(
  stage: FdqlLookupStage,
  diagnostics: FdqlDiagnostic[],
): number | undefined {
  if (!stage.cacheTtlRaw) return undefined;
  if (stage.cache !== 'persistent') {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_LOOKUP_CACHE',
        'Lookup cache TTL is only valid with `cache persistent`.',
        stage.range,
      ),
    );
    return undefined;
  }
  const cacheTtlMs = parseCacheTtlMs(stage.cacheTtlRaw);
  if (!cacheTtlMs) {
    diagnostics.push(
      diagnosticAtRange('FDQL_INVALID_LOOKUP_CACHE', 'Invalid lookup cache TTL.', stage.range),
    );
  }
  return cacheTtlMs;
}
