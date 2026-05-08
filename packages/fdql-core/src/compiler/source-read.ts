import { parseFdql } from '../parser.ts';
import {
  createProviderDialectRegistry,
  type FdqlProviderDialectRegistry,
  type FdqlProviderSourceAlias,
  providerNamespaceFromCall,
} from '../provider.ts';
import type {
  FdqlAggregateFromStage,
  FdqlCompileOptions,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlLocalPlanStage,
  FdqlProgram,
  FdqlProviderOrderByClause,
  FdqlReadCompileResult,
  FdqlReturnStage,
  FdqlUnionProgram,
  FdqlValue,
} from '../types.ts';
import { resolveAliases, type ResolvedAliasValue, scalarAliases } from './aliases.ts';
import { isReservedCommand } from './command.ts';
import { compilerError, duplicateStage } from './diagnostics.ts';
import {
  validateExpressionAliases,
  validateProjectionReferences,
  validateStageProvider,
} from './expression-validation.ts';
import { compileLocalStage } from './local-stages.ts';
import { compileLookupStage } from './lookup.ts';
import { compileProviderAggregateItems } from './provider-aggregate.ts';
import { type ResolvedPreambleSettings, resolveSettings } from './settings.ts';

export function providerRegistry(options: FdqlCompileOptions): FdqlProviderDialectRegistry {
  return createProviderDialectRegistry(options.providers ?? []);
}

export function compileSingleFdqlRead(
  source: string,
  options: FdqlCompileOptions,
): FdqlReadCompileResult {
  const providers = providerRegistry(options);
  const parsed = parseFdql(source);
  const diagnostics: FdqlDiagnostic[] = [...parsed.diagnostics];
  const ast = parsed.ast;
  if (!ast || !parsed.ok) return { ast, diagnostics, ok: false };
  if (isUnionAst(ast)) {
    diagnostics.push(compilerError('FDQL_PARSE_ERROR', 'Nested `union all` is not supported.'));
    return { ast, diagnostics, ok: false };
  }
  const program: FdqlProgram = ast;
  const reservedCommand = program.stages.find((stage) =>
    stage.kind === 'unsupported' && isReservedCommand(stage.text)
  );
  if (reservedCommand) {
    diagnostics.push(
      compilerError(
        'FDQL_UNSUPPORTED_COMMAND',
        'FDQL command is reserved but not executable yet.',
        reservedCommand.line,
      ),
    );
    return { ast, diagnostics, ok: false };
  }

  const preamble = resolveSettings(program.settings, options, providers, diagnostics);
  const aliases = resolveAliases(program.aliases, preamble.providerContext, providers, diagnostics);
  const scalarAliasValues = scalarAliases(aliases);

  if (!program.from) {
    diagnostics.push(compilerError('FDQL_PARSE_ERROR', 'FDQL read queries need one `from` stage.'));
    return { ast, diagnostics, ok: false };
  }

  if (program.from.mode === 'aggregate') {
    const aggregateFrom = program.from;
    return compileAggregateSourceRead({
      aliases,
      ast,
      diagnostics,
      from: aggregateFrom,
      preamble,
      program,
      providers,
      scalarAliasValues,
    });
  }

  const sourceAlias = aliases[program.from.sourceAlias];
  if (!sourceAlias) {
    diagnostics.push(compilerError(
      'FDQL_UNDECLARED_ALIAS',
      `Source alias ${program.from.sourceAlias} is not declared.`,
      program.from.line,
    ));
  } else if (sourceAlias.kind !== 'source') {
    diagnostics.push(compilerError(
      'FDQL_UNDECLARED_ALIAS',
      `Alias ${program.from.sourceAlias} is not a provider source.`,
      program.from.line,
    ));
  }

  const sourceProvider = sourceAlias?.kind === 'source' ? sourceAlias.source.provider : undefined;
  const sourceDialect = sourceProvider ? providers[sourceProvider] : undefined;
  const rowAlias = program.from.rowAlias;
  const availableRowAliases = new Set([rowAlias]);
  const localStages: FdqlLocalPlanStage[] = [];
  let providerPredicate: FdqlExpression | undefined;
  let providerOrderBy: FdqlProviderOrderByClause | undefined;
  let providerOrderByLine: number | undefined;
  let providerLimit: number | undefined;
  let providerLimitLine: number | undefined;
  let returnStage: FdqlReturnStage | undefined;
  let returnLine: number | undefined;

  for (const stage of program.stages) {
    switch (stage.kind) {
      case 'providerWhere':
        if (
          !validateStageProvider(stage.provider, sourceProvider, providers, diagnostics, stage.line)
        ) break;
        validateExpressionAliases(
          stage.expression,
          scalarAliasValues,
          providers,
          diagnostics,
          stage.line,
        );
        sourceDialect?.validateWhere({
          aliases: scalarAliasValues,
          availableRowAliases,
          diagnostics,
          expression: stage.expression,
          line: stage.line,
          lookup: false,
          rowAlias,
        });
        providerPredicate = providerPredicate
          ? { kind: 'binary', left: providerPredicate, operator: 'and', right: stage.expression }
          : stage.expression;
        break;
      case 'providerOrderBy':
        if (
          !validateStageProvider(stage.provider, sourceProvider, providers, diagnostics, stage.line)
        ) break;
        if (providerOrderByLine !== undefined) {
          diagnostics.push(
            duplicateStage(`${stage.provider} order by`, providerOrderByLine, stage.line),
          );
          break;
        }
        validateExpressionAliases(
          stage.expression,
          scalarAliasValues,
          providers,
          diagnostics,
          stage.line,
        );
        sourceDialect?.validateOrderBy({
          diagnostics,
          expression: stage.expression,
          line: stage.line,
          rowAlias,
        });
        providerOrderBy = { direction: stage.direction, expression: stage.expression };
        providerOrderByLine = stage.line;
        break;
      case 'providerLimit':
        if (
          !validateStageProvider(stage.provider, sourceProvider, providers, diagnostics, stage.line)
        ) break;
        if (providerLimitLine !== undefined) {
          diagnostics.push(
            duplicateStage(`${stage.provider} limit`, providerLimitLine, stage.line),
          );
          break;
        }
        if (!Number.isInteger(stage.value) || stage.value <= 0) {
          diagnostics.push(
            compilerError(
              'FDQL_PARSE_ERROR',
              `\`${stage.provider} limit\` must be a positive integer.`,
              stage.line,
            ),
          );
        }
        providerLimit = stage.value;
        providerLimitLine = stage.line;
        break;
      case 'filter':
      case 'sortBy':
      case 'take':
      case 'unwind':
      case 'with': {
        const localStage = compileLocalStage(
          stage,
          availableRowAliases,
          scalarAliasValues,
          providers,
          diagnostics,
        );
        if (localStage) localStages.push(localStage);
        break;
      }
      case 'aggregate':
        localStages.push(
          compileLocalStage(
            stage,
            availableRowAliases,
            scalarAliasValues,
            providers,
            diagnostics,
          )!,
        );
        break;
      case 'lookup': {
        const lookupStage = compileLookupStage(
          stage,
          aliases,
          availableRowAliases,
          scalarAliasValues,
          preamble.providerContext,
          providers,
          diagnostics,
        );
        if (lookupStage) {
          localStages.push(lookupStage);
          availableRowAliases.add(stage.rowAlias);
        }
        break;
      }
      case 'return':
        if (returnLine !== undefined) {
          diagnostics.push(duplicateStage('return', returnLine, stage.line));
          break;
        }
        validateProjectionReferences(
          stage.items,
          scalarAliasValues,
          availableRowAliases,
          providers,
          diagnostics,
        );
        returnStage = stage;
        returnLine = stage.line;
        break;
      case 'unsupported':
        diagnostics.push(
          compilerError('FDQL_UNKNOWN_STAGE', `Unsupported FDQL stage: ${stage.text}.`, stage.line),
        );
        break;
    }
  }

  if (!returnStage) {
    diagnostics.push(
      compilerError(
        'FDQL_MISSING_RETURN',
        'Read pipelines need an explicit `return`.',
        program.from.line,
      ),
    );
  }

  if (
    !providerLimit && !preamble.settings.allowUnboundedReads
    && !sourceDialect?.hasBoundedPredicate?.(providerPredicate, rowAlias)
  ) {
    diagnostics.push(compilerError(
      'FDQL_UNBOUNDED_PROVIDER_READ',
      'Add provider limit, query by document id, or set fdql.allowUnboundedReads = true.',
      program.from.line,
    ));
  }

  const sourceValue = sourceAlias?.kind === 'source' ? sourceAlias : undefined;
  if (sourceValue?.binding) {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_FROM_SOURCE',
        'Parent-bound subcollection sources can only be used in lookup.',
        program.from.line,
      ),
    );
  }
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !sourceValue
    || !returnStage
  ) {
    return { ast, diagnostics, ok: false };
  }

  return {
    ast,
    diagnostics,
    ok: true,
    plan: {
      aliases: scalarAliasValues,
      kind: 'read',
      localStages,
      provider: {
        ...(sourceValue.binding ? { binding: sourceValue.binding } : {}),
        ...(sourceValue.fieldMask ? { fieldMask: sourceValue.fieldMask } : {}),
        ...(providerLimit === undefined ? {} : { limit: providerLimit }),
        ...(providerOrderBy ? { orderBy: providerOrderBy } : {}),
        ...(providerPredicate ? { predicate: providerPredicate } : {}),
        source: sourceValue.source,
      },
      returnStage,
      rowAlias,
      settings: preamble.settings,
    },
  };
}

function compileAggregateSourceRead(input: {
  readonly aliases: Readonly<Record<string, ResolvedAliasValue>>;
  readonly ast: FdqlProgram;
  readonly diagnostics: FdqlDiagnostic[];
  readonly from: FdqlAggregateFromStage;
  readonly preamble: ResolvedPreambleSettings;
  readonly program: FdqlProgram;
  readonly providers: FdqlProviderDialectRegistry;
  readonly scalarAliasValues: Readonly<Record<string, FdqlValue>>;
}): FdqlReadCompileResult {
  const from = input.from;
  const sourceAlias = resolveAggregateSource(
    from,
    input.aliases,
    input.preamble.providerContext,
    input.providers,
    input.diagnostics,
  );
  const sourceProvider = sourceAlias?.source.provider;
  const sourceDialect = sourceProvider ? input.providers[sourceProvider] : undefined;
  const providerRowAlias = from.providerRowAlias;
  const providerClauseRowAliases = new Set(providerRowAlias ? [providerRowAlias] : []);
  let providerPredicate: FdqlExpression | undefined;
  const localStages: FdqlLocalPlanStage[] = [];
  let returnStage: FdqlReturnStage | undefined;
  let returnLine: number | undefined;

  for (const clause of from.clauses) {
    if (
      !validateStageProvider(
        clause.provider,
        sourceProvider,
        input.providers,
        input.diagnostics,
        clause.line,
      )
    ) {
      continue;
    }
    if (clause.kind !== 'providerWhere') {
      input.diagnostics.push(
        compilerError(
          'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE_CLAUSE',
          'Provider aggregate sources support provider `where` clauses only.',
          clause.line,
        ),
      );
      continue;
    }
    if (!providerRowAlias) {
      input.diagnostics.push(
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
      input.scalarAliasValues,
      input.providers,
      input.diagnostics,
      clause.line,
    );
    sourceDialect?.validateWhere({
      aliases: input.scalarAliasValues,
      availableRowAliases: providerClauseRowAliases,
      diagnostics: input.diagnostics,
      expression: clause.expression,
      line: clause.line,
      lookup: false,
      rowAlias: providerRowAlias,
    });
    providerPredicate = providerPredicate
      ? { kind: 'binary', left: providerPredicate, operator: 'and', right: clause.expression }
      : clause.expression;
  }

  const aggregateItems = compileProviderAggregateItems({
    diagnostics: input.diagnostics,
    line: from.line,
    ...(providerRowAlias ? { providerRowAlias } : {}),
    providers: input.providers,
    scalarAliases: input.scalarAliasValues,
    sourceProvider: from.provider,
    yieldItems: from.yieldItems,
  });
  const availableRowAliases = new Set(aggregateItems.map((item) => item.alias));

  for (const stage of input.program.stages) {
    switch (stage.kind) {
      case 'providerWhere':
      case 'providerOrderBy':
      case 'providerLimit':
        input.diagnostics.push(
          compilerError(
            'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE_CLAUSE',
            'Provider aggregate source clauses must be inside the aggregate source block.',
            stage.line,
          ),
        );
        break;
      case 'filter':
      case 'sortBy':
      case 'take':
      case 'unwind':
      case 'with':
      case 'aggregate': {
        const localStage = compileLocalStage(
          stage,
          availableRowAliases,
          input.scalarAliasValues,
          input.providers,
          input.diagnostics,
        );
        if (localStage) localStages.push(localStage);
        break;
      }
      case 'lookup': {
        const lookupStage = compileLookupStage(
          stage,
          input.aliases,
          availableRowAliases,
          input.scalarAliasValues,
          input.preamble.providerContext,
          input.providers,
          input.diagnostics,
        );
        if (lookupStage) {
          localStages.push(lookupStage);
          availableRowAliases.add(stage.rowAlias);
        }
        break;
      }
      case 'return':
        if (returnLine !== undefined) {
          input.diagnostics.push(duplicateStage('return', returnLine, stage.line));
          break;
        }
        validateProjectionReferences(
          stage.items,
          input.scalarAliasValues,
          availableRowAliases,
          input.providers,
          input.diagnostics,
        );
        returnStage = stage;
        returnLine = stage.line;
        break;
      case 'unsupported':
        input.diagnostics.push(
          compilerError('FDQL_UNKNOWN_STAGE', `Unsupported FDQL stage: ${stage.text}.`, stage.line),
        );
        break;
    }
  }

  if (!returnStage) {
    input.diagnostics.push(
      compilerError(
        'FDQL_MISSING_RETURN',
        'Read pipelines need an explicit `return`.',
        from.line,
      ),
    );
  }

  if (
    input.diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !sourceAlias
    || !returnStage
  ) {
    return { ast: input.ast, diagnostics: input.diagnostics, ok: false };
  }

  return {
    ast: input.ast,
    diagnostics: input.diagnostics,
    ok: true,
    plan: {
      aliases: input.scalarAliasValues,
      kind: 'read',
      localStages,
      provider: {
        ...(sourceAlias.fieldMask ? { fieldMask: sourceAlias.fieldMask } : {}),
        ...(providerPredicate ? { predicate: providerPredicate } : {}),
        source: sourceAlias.source,
      },
      providerAggregate: {
        items: aggregateItems,
        rowAlias: providerRowAlias ?? '__aggregate',
      },
      returnStage,
      rowAlias: providerRowAlias ?? '__aggregate',
      settings: input.preamble.settings,
    },
  };
}

function resolveAggregateSource(
  from: FdqlAggregateFromStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  providerContext: ResolvedPreambleSettings['providerContext'],
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const sourceAlias = from.sourceExpression
    ? resolveAggregateSourceExpression(from, aliases, providerContext, providers, diagnostics)
    : resolveAggregateSourceAlias(from, aliases, diagnostics);
  if (!sourceAlias) return null;
  if (sourceAlias.source.provider !== from.provider) {
    diagnostics.push(
      compilerError(
        'FDQL_PROVIDER_MISMATCH',
        `Aggregate source provider ${from.provider} does not match source provider ${sourceAlias.source.provider}.`,
        from.line,
      ),
    );
    return null;
  }
  if (sourceAlias.binding) {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_FROM_SOURCE',
        'Parent-bound subcollection sources cannot be used in top-level provider aggregate sources.',
        from.line,
      ),
    );
    return null;
  }
  return sourceAlias;
}

function resolveAggregateSourceAlias(
  from: FdqlAggregateFromStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const sourceAlias = aliases[from.sourceAlias];
  if (!sourceAlias) {
    diagnostics.push(
      compilerError(
        'FDQL_UNDECLARED_ALIAS',
        `Source alias ${from.sourceAlias} is not declared.`,
        from.line,
      ),
    );
    return null;
  }
  if (sourceAlias.kind !== 'source') {
    diagnostics.push(
      compilerError(
        'FDQL_UNDECLARED_ALIAS',
        `Alias ${from.sourceAlias} is not a provider source.`,
        from.line,
      ),
    );
    return null;
  }
  return sourceAlias;
}

function resolveAggregateSourceExpression(
  from: FdqlAggregateFromStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  providerContext: ResolvedPreambleSettings['providerContext'],
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const expression = from.sourceExpression;
  if (!expression || expression.kind !== 'call') {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_FROM_SOURCE',
        'Provider aggregate source must use a source alias or provider source call.',
        from.line,
      ),
    );
    return null;
  }
  const namespace = providerNamespaceFromCall(expression.name);
  if (namespace !== from.provider) {
    diagnostics.push(
      compilerError(
        'FDQL_PROVIDER_MISMATCH',
        `Aggregate source provider ${from.provider} does not match source expression ${expression.name}.`,
        from.line,
      ),
    );
    return null;
  }
  const provider = providers[namespace];
  if (!provider?.resolveSourceExpression) {
    diagnostics.push(
      compilerError(
        'FDQL_INVALID_FROM_SOURCE',
        `Provider ${namespace} does not support inline aggregate sources.`,
        from.line,
      ),
    );
    return null;
  }
  return provider.resolveSourceExpression({
    aliases,
    availableRowAliases: new Set(),
    defaultProviderContext: providerContext,
    diagnostics,
    expression,
    line: from.line,
    sourceAlias: from.sourceAlias,
  });
}

export function isUnionAst(ast: unknown): ast is FdqlUnionProgram {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'union';
}
