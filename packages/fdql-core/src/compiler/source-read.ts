import { parseFdql } from '../parser.ts';
import { createProviderDialectRegistry, type FdqlProviderDialectRegistry } from '../provider.ts';
import type {
  FdqlCompileOptions,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlLocalPlanStage,
  FdqlProgram,
  FdqlProviderOrderByClause,
  FdqlReadCompileResult,
  FdqlReturnStage,
  FdqlUnionProgram,
} from '../types.ts';
import { resolveAliases, scalarAliases } from './aliases.ts';
import { isReservedCommand } from './command.ts';
import { compilerError, duplicateStage } from './diagnostics.ts';
import {
  validateAliases,
  validateExpressionAliases,
  validateStageProvider,
} from './expression-validation.ts';
import { compileLocalStage } from './local-stages.ts';
import { compileLookupStage } from './lookup.ts';
import { resolveSettings } from './settings.ts';

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
        validateAliases(stage, scalarAliasValues, providers, diagnostics);
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
    returnStage = {
      column: program.from.column,
      items: [{ expression: { kind: 'wildcard' }, label: '*' }],
      kind: 'return',
      line: program.from.line,
      range: program.from.range,
    };
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
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !sourceValue) {
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

export function isUnionAst(ast: unknown): ast is FdqlUnionProgram {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'union';
}
