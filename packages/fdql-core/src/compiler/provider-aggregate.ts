import type { FdqlDefaultProviderContext, FdqlProviderDialectRegistry } from '../provider.ts';
import { providerNamespaceFromCall } from '../provider.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlProjectionItem,
  FdqlProviderAggregateItem,
  FdqlProviderAggregateOutput,
  FdqlProviderAggregatePlan,
  FdqlProviderAggregatePlanStage,
  FdqlProviderAggregateStage,
  FdqlProviderAggregateYieldItem,
  FdqlValue,
} from '../types.ts';
import type { ResolvedAliasValue } from './aliases.ts';
import { compilerError, duplicateStage } from './diagnostics.ts';
import { validateExpressionAliases, validateStageProvider } from './expression-validation.ts';
import { resolveProviderStageSource } from './provider-source.ts';
import { parseCacheTtlMs } from './settings.ts';

export function compileProviderAggregateStage(
  stage: FdqlProviderAggregateStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  availableRowAliases: ReadonlySet<string>,
  scalarAliases: Readonly<Record<string, FdqlValue>>,
  providerContext: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderAggregatePlanStage | null {
  const sourceAlias = resolveProviderStageSource(
    stage,
    aliases,
    availableRowAliases,
    providerContext,
    providers,
    diagnostics,
  );
  if (!sourceAlias) return null;
  if (sourceAlias.source.provider !== stage.provider) {
    diagnostics.push(
      compilerError(
        'FDQL_PROVIDER_MISMATCH',
        `Aggregate provider ${stage.provider} does not match source provider ${sourceAlias.source.provider}.`,
        stage.line,
      ),
    );
    return null;
  }
  const sourceDialect = providers[stage.provider];
  const providerRowAlias = stage.providerRowAlias;
  const rowsForAggregate = new Set([
    ...availableRowAliases,
    ...(providerRowAlias ? [providerRowAlias] : []),
  ]);
  const cacheTtlMs = resolveProviderAggregateCacheTtl(stage, diagnostics);
  let providerPredicate: FdqlExpression | undefined;
  let providerOrderByLine: number | undefined;
  let providerLimitLine: number | undefined;

  for (const clause of stage.clauses) {
    if (
      !validateStageProvider(clause.provider, stage.provider, providers, diagnostics, clause.line)
    ) {
      continue;
    }
    if (clause.kind === 'providerOrderBy') {
      if (providerOrderByLine !== undefined) {
        diagnostics.push(
          duplicateStage(`${clause.provider} order by`, providerOrderByLine, clause.line),
        );
      }
      providerOrderByLine = clause.line;
      diagnostics.push(unsupportedProviderAggregateClause(clause.line));
      continue;
    }
    if (clause.kind === 'providerLimit') {
      if (providerLimitLine !== undefined) {
        diagnostics.push(
          duplicateStage(`${clause.provider} limit`, providerLimitLine, clause.line),
        );
      }
      providerLimitLine = clause.line;
      diagnostics.push(unsupportedProviderAggregateClause(clause.line));
      continue;
    }
    if (!providerRowAlias) {
      diagnostics.push(
        compilerError(
          'FDQL_INVALID_PROVIDER_AGGREGATE',
          'Provider aggregate `where` needs a source row alias.',
          clause.line,
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
    sourceDialect?.validateWhere({
      aliases: scalarAliases,
      availableRowAliases: rowsForAggregate,
      diagnostics,
      expression: clause.expression,
      line: clause.line,
      lookup: true,
      rowAlias: providerRowAlias,
    });
    providerPredicate = providerPredicate
      ? { kind: 'binary', left: providerPredicate, operator: 'and', right: clause.expression }
      : clause.expression;
  }

  const aggregate = compileProviderAggregatePlan({
    diagnostics,
    line: stage.line,
    ...(providerRowAlias ? { providerRowAlias } : {}),
    providers,
    scalarAliases,
    sourceProvider: stage.provider,
    yieldItems: stage.yieldItems,
  });
  validateOutputCollisions(aggregate.outputs, availableRowAliases, diagnostics, stage.line);
  if (!aggregate.items.length) return null;

  return {
    aggregate,
    ...(stage.cache ? { cache: stage.cache } : {}),
    ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
    column: stage.column,
    kind: 'providerAggregate',
    line: stage.line,
    provider: {
      ...(sourceAlias.binding ? { binding: sourceAlias.binding } : {}),
      ...(sourceAlias.fieldMask ? { fieldMask: sourceAlias.fieldMask } : {}),
      ...(providerPredicate ? { predicate: providerPredicate } : {}),
      source: sourceAlias.source,
    },
    range: stage.range,
    sourceAlias: stage.sourceAlias,
  };
}

export function compileProviderAggregatePlan(input: {
  readonly diagnostics: FdqlDiagnostic[];
  readonly line: number;
  readonly missingYieldCode?: string | undefined;
  readonly providerRowAlias?: string | undefined;
  readonly providers: FdqlProviderDialectRegistry;
  readonly scalarAliases: Readonly<Record<string, FdqlValue>>;
  readonly sourceProvider: string;
  readonly yieldItems?: readonly FdqlProviderAggregateYieldItem[] | undefined;
}): FdqlProviderAggregatePlan {
  if (!input.yieldItems?.length) {
    input.diagnostics.push(
      compilerError(
        input.missingYieldCode ?? 'FDQL_MISSING_PROVIDER_AGGREGATE_YIELD',
        'Provider aggregate needs one `yield` projection.',
        input.line,
      ),
    );
    return { items: [], outputs: [], rowAlias: input.providerRowAlias ?? '__aggregate' };
  }

  const outputAliases = new Set<string>();
  const items: FdqlProviderAggregateItem[] = [];
  const outputs: FdqlProviderAggregateOutput[] = [];

  for (const yieldItem of input.yieldItems) {
    if (yieldItem.kind === 'flat') {
      if (yieldItem.item.spread) {
        compileAggregateProjectionItem(input, yieldItem.item, `__fdql_${items.length}`);
        continue;
      }
      const alias = yieldItem.item.alias;
      if (
        !alias
        || !registerOutputAlias(
          alias,
          outputAliases,
          input.diagnostics,
          yieldItem.item.line ?? input.line,
        )
      ) {
        if (!alias) missingYieldAlias(input, yieldItem.item);
        continue;
      }
      const itemAlias = `__fdql_${items.length}`;
      const item = compileAggregateProjectionItem(input, yieldItem.item, itemAlias);
      if (!item) continue;
      items.push(item);
      outputs.push({ alias, itemAlias, kind: 'field' });
      continue;
    }

    const alias = yieldItem.alias;
    if (
      !alias
      || !registerOutputAlias(alias, outputAliases, input.diagnostics, yieldItem.line ?? input.line)
    ) {
      if (!alias) {
        input.diagnostics.push(
          compilerError(
            'FDQL_INVALID_PROVIDER_AGGREGATE_YIELD',
            'Provider aggregate object yield expressions need `as alias`.',
            yieldItem.line ?? input.line,
            yieldItem.column,
          ),
        );
      }
      continue;
    }
    const fieldAliases = new Set<string>();
    const fields: { alias: string; itemAlias: string; }[] = [];
    for (const item of yieldItem.items) {
      const fieldAlias = item.alias;
      if (
        !fieldAlias
        || !registerOutputAlias(
          fieldAlias,
          fieldAliases,
          input.diagnostics,
          item.line ?? input.line,
        )
      ) {
        if (!fieldAlias) missingYieldAlias(input, item);
        continue;
      }
      const itemAlias = `__fdql_${items.length}`;
      const aggregateItem = compileAggregateProjectionItem(input, item, itemAlias);
      if (!aggregateItem) continue;
      items.push(aggregateItem);
      fields.push({ alias: fieldAlias, itemAlias });
    }
    outputs.push({ alias, fields, kind: 'map' });
  }

  return { items, outputs, rowAlias: input.providerRowAlias ?? '__aggregate' };
}

export function providerAggregateOutputAliases(
  aggregate: FdqlProviderAggregatePlan,
): readonly string[] {
  return aggregate.outputs.map((output) => output.alias);
}

function compileAggregateProjectionItem(
  input: {
    readonly diagnostics: FdqlDiagnostic[];
    readonly line: number;
    readonly providerRowAlias?: string | undefined;
    readonly providers: FdqlProviderDialectRegistry;
    readonly scalarAliases: Readonly<Record<string, FdqlValue>>;
    readonly sourceProvider: string;
  },
  item: FdqlProjectionItem,
  itemAlias: string,
): FdqlProviderAggregateItem | null {
  if (item.spread) {
    input.diagnostics.push(
      compilerError(
        'FDQL_INVALID_SPREAD_PROJECTION',
        'Spread projections are only supported in `return`.',
        item.line ?? input.line,
        item.column,
      ),
    );
    return null;
  }
  if (item.expression.kind !== 'call') {
    input.diagnostics.push(
      compilerError(
        'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE',
        'Provider aggregate yield expressions must use provider aggregate functions.',
        item.line ?? input.line,
      ),
    );
    return null;
  }
  const sourceDialect = input.providers[input.sourceProvider];
  const functionProvider = providerNamespaceFromCall(item.expression.name);
  if (functionProvider !== input.sourceProvider) {
    input.diagnostics.push(
      compilerError(
        'FDQL_PROVIDER_MISMATCH',
        `Aggregate function ${item.expression.name} does not match source provider ${input.sourceProvider}.`,
        item.line ?? input.line,
      ),
    );
    return null;
  }
  if (!sourceDialect?.aggregateFunctions?.has(item.expression.name)) {
    input.diagnostics.push(
      compilerError(
        'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE',
        `Unsupported provider aggregate function ${item.expression.name}.`,
        item.line ?? input.line,
      ),
    );
    return null;
  }
  if (!input.providerRowAlias && item.expression.name !== `${input.sourceProvider}.count`) {
    input.diagnostics.push(
      compilerError(
        'FDQL_INVALID_PROVIDER_AGGREGATE',
        'Provider aggregate field functions need a source row alias.',
        item.line ?? input.line,
      ),
    );
    return null;
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
  return {
    alias: itemAlias,
    ...(item.expression.args[0] ? { expression: item.expression.args[0] } : {}),
    functionName: item.expression.name,
  };
}

function registerOutputAlias(
  alias: string,
  aliases: Set<string>,
  diagnostics: FdqlDiagnostic[],
  line: number,
): boolean {
  if (!aliases.has(alias)) {
    aliases.add(alias);
    return true;
  }
  diagnostics.push(
    compilerError('FDQL_DUPLICATE_YIELD_ALIAS', `Duplicate aggregate yield alias ${alias}.`, line),
  );
  return false;
}

function validateOutputCollisions(
  outputs: readonly FdqlProviderAggregateOutput[],
  availableRowAliases: ReadonlySet<string>,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  for (const output of outputs) {
    if (!availableRowAliases.has(output.alias)) continue;
    diagnostics.push(
      compilerError(
        'FDQL_ROW_BINDING_COLLISION',
        `Aggregate yield alias ${output.alias} already exists in the current row.`,
        line,
      ),
    );
  }
}

function missingYieldAlias(
  input: { readonly diagnostics: FdqlDiagnostic[]; readonly line: number; },
  item: FdqlProjectionItem,
): void {
  input.diagnostics.push(
    compilerError(
      'FDQL_INVALID_PROVIDER_AGGREGATE_YIELD',
      'Provider aggregate yield expressions need `as alias`.',
      item.line ?? input.line,
      item.column,
    ),
  );
}

function unsupportedProviderAggregateClause(line: number): FdqlDiagnostic {
  return compilerError(
    'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE_CLAUSE',
    'Provider aggregate supports provider `where` clauses only.',
    line,
  );
}

function resolveProviderAggregateCacheTtl(
  stage: FdqlProviderAggregateStage,
  diagnostics: FdqlDiagnostic[],
): number | undefined {
  if (!stage.cacheTtlRaw) return undefined;
  if (stage.cache !== 'persistent') {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_CACHE',
        'Provider aggregate cache TTL is only valid with `cache persistent`.',
        stage.line,
      ),
    );
    return undefined;
  }
  const cacheTtlMs = parseCacheTtlMs(stage.cacheTtlRaw);
  if (!cacheTtlMs) {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_LOOKUP_CACHE',
        'Invalid provider aggregate cache TTL.',
        stage.line,
      ),
    );
  }
  return cacheTtlMs;
}
