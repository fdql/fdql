import { evaluateExpression } from './evaluator.ts';
import { parseFdql } from './parser.ts';
import {
  createProviderDialectRegistry,
  type FdqlDefaultProviderContext,
  type FdqlProviderDialectRegistry,
  type FdqlProviderSourceAlias,
  type FdqlResolvedAliasValue,
  providerNamespaceFromCall,
} from './provider.ts';
import type {
  FdqlAliasDeclaration,
  FdqlAst,
  FdqlClearCacheCommandPlan,
  FdqlCompileOptions,
  FdqlCompileResult,
  FdqlDiagnostic,
  FdqlExecutionSettings,
  FdqlExpression,
  FdqlLocalPlanStage,
  FdqlLookupPlanStage,
  FdqlLookupStage,
  FdqlProgram,
  FdqlProviderOrderByClause,
  FdqlReadCompileResult,
  FdqlReturnStage,
  FdqlSetDeclaration,
  FdqlSingleReadPlan,
  FdqlStage,
  FdqlUnionProgram,
  FdqlValue,
} from './types.ts';
import { arrayValue, literalToValue, mapValue, missingValue, scalarValue } from './value.ts';

const defaultSettings: FdqlExecutionSettings = {
  allowUnboundedReads: false,
  cache: 'off',
  cacheTtlMs: 86_400_000,
  pageSize: 100,
  readBudget: 5000,
  timeoutMs: 60_000,
};

const maxCacheTtlMs = 30 * 86_400_000;

type ResolvedAliasValue = FdqlResolvedAliasValue;

type ClearCacheCommandStage = Extract<FdqlStage, { readonly kind: 'unsupported'; }>;

interface ResolvedPreambleSettings {
  readonly providerContext: FdqlDefaultProviderContext;
  readonly settings: FdqlExecutionSettings;
}

export function compileFdqlRead(
  source: string,
  options: FdqlCompileOptions,
): FdqlReadCompileResult {
  const unionParts = splitUnionAll(source);
  if (unionParts.length > 1) return compileUnionRead(unionParts, options);
  return compileSingleFdqlRead(source, options);
}

export function compileFdql(
  source: string,
  options: FdqlCompileOptions,
): FdqlCompileResult {
  const command = compileFdqlCommand(source, options);
  if (command) return command;
  return compileFdqlRead(source, options);
}

function compileFdqlCommand(
  source: string,
  options: FdqlCompileOptions,
): FdqlCompileResult | null {
  const parsed = parseFdql(source);
  const ast = parsed.ast;
  if (!ast) return null;
  const commandStage = clearCacheCommandStage(ast);
  if (!commandStage) return null;
  const diagnostics: FdqlDiagnostic[] = [...parsed.diagnostics];
  if (isUnionAst(ast) || !isStandaloneCommand(ast, commandStage)) {
    diagnostics.push(error(
      'FDQL_COMMAND_MIXED_WITH_PIPELINE',
      '`clear cache` must be the only command in the FDQL source.',
      commandStage.line,
    ));
    return { ast, diagnostics, ok: false };
  }
  if (!parsed.ok) return { ast, diagnostics, ok: false };
  const plan = parseClearCacheCommand(commandStage, providerRegistry(options), diagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !plan) {
    return { ast, diagnostics, ok: false };
  }
  return { ast, diagnostics, ok: true, plan };
}

function providerRegistry(options: FdqlCompileOptions): FdqlProviderDialectRegistry {
  return createProviderDialectRegistry(options.providers ?? []);
}

function defaultProviderContext(options: FdqlCompileOptions): FdqlDefaultProviderContext {
  return cloneProviderContext(options.defaultProviderContext ?? {});
}

function compileUnionRead(
  unionParts: readonly string[],
  options: FdqlCompileOptions,
): FdqlReadCompileResult {
  const preamble = sharedPreamble(unionParts[0]!);
  const branches = unionParts.map((part, index) =>
    index === 0 ? part : `${preamble}${preamble ? '\n' : ''}${part}`
  );
  const compiledBranches = branches.map((branch) => compileSingleFdqlRead(branch, options));
  const diagnostics = compiledBranches.flatMap((branch) => branch.diagnostics);
  const plans: FdqlSingleReadPlan[] = compiledBranches.flatMap((branch) =>
    branch.ok && branch.plan.kind === 'read' ? [branch.plan] : []
  );
  const astBranches: FdqlProgram[] = compiledBranches.flatMap((branch) =>
    branch.ast && !isUnionAst(branch.ast) ? [branch.ast] : []
  );
  const ast: FdqlUnionProgram = { branches: astBranches, kind: 'union' };
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    || plans.length !== branches.length
  ) {
    return { ast, diagnostics, ok: false };
  }
  return {
    ast,
    diagnostics,
    ok: true,
    plan: {
      branches: plans,
      kind: 'union',
      settings: plans[0]?.settings ?? defaultSettings,
    },
  };
}

function compileSingleFdqlRead(
  source: string,
  options: FdqlCompileOptions,
): FdqlReadCompileResult {
  const providers = providerRegistry(options);
  const parsed = parseFdql(source);
  const diagnostics: FdqlDiagnostic[] = [...parsed.diagnostics];
  const ast = parsed.ast;
  if (!ast || !parsed.ok) return { ast, diagnostics, ok: false };
  if (isUnionAst(ast)) {
    diagnostics.push(error('FDQL_PARSE_ERROR', 'Nested `union all` is not supported.'));
    return { ast, diagnostics, ok: false };
  }
  const reservedCommand = ast.stages.find((stage) =>
    stage.kind === 'unsupported' && isReservedCommand(stage.text)
  );
  if (reservedCommand) {
    diagnostics.push(
      error(
        'FDQL_UNSUPPORTED_COMMAND',
        'FDQL command is reserved but not executable yet.',
        reservedCommand.line,
      ),
    );
    return { ast, diagnostics, ok: false };
  }

  const preamble = resolveSettings(ast.settings, options, providers, diagnostics);
  const aliases = resolveAliases(ast.aliases, preamble.providerContext, providers, diagnostics);
  const scalarAliases = Object.fromEntries(
    Object.entries(aliases).flatMap(([name, value]) =>
      value.kind === 'value' ? [[name, value.value] as const] : []
    ),
  );

  if (!ast.from) {
    diagnostics.push(error('FDQL_PARSE_ERROR', 'FDQL read queries need one `from` stage.'));
    return { ast, diagnostics, ok: false };
  }

  const sourceAlias = aliases[ast.from.sourceAlias];
  if (!sourceAlias) {
    diagnostics.push(error(
      'FDQL_UNDECLARED_ALIAS',
      `Source alias ${ast.from.sourceAlias} is not declared.`,
      ast.from.line,
    ));
  } else if (sourceAlias.kind !== 'source') {
    diagnostics.push(error(
      'FDQL_UNDECLARED_ALIAS',
      `Alias ${ast.from.sourceAlias} is not a provider source.`,
      ast.from.line,
    ));
  }

  const sourceProvider = sourceAlias?.kind === 'source' ? sourceAlias.source.provider : undefined;
  const sourceDialect = sourceProvider ? providers[sourceProvider] : undefined;
  const rowAlias = ast.from.rowAlias;
  const availableRowAliases = new Set([rowAlias]);
  const localStages: FdqlLocalPlanStage[] = [];
  let providerPredicate: FdqlExpression | undefined;
  let providerOrderBy: FdqlProviderOrderByClause | undefined;
  let providerOrderByLine: number | undefined;
  let providerLimit: number | undefined;
  let providerLimitLine: number | undefined;
  let returnStage: FdqlReturnStage | undefined;
  let returnLine: number | undefined;

  for (const stage of ast.stages) {
    switch (stage.kind) {
      case 'providerWhere':
        if (
          !validateStageProvider(stage.provider, sourceProvider, providers, diagnostics, stage.line)
        ) break;
        validateExpressionAliases(
          stage.expression,
          scalarAliases,
          providers,
          diagnostics,
          stage.line,
        );
        sourceDialect?.validateWhere({
          aliases: scalarAliases,
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
          scalarAliases,
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
            error(
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
      case 'with':
        validateAliases(stage, scalarAliases, providers, diagnostics);
        localStages.push(stage);
        if (stage.kind === 'unwind') availableRowAliases.add(stage.rowAlias);
        break;
      case 'aggregate':
        validateAggregateStage(stage, scalarAliases, providers, diagnostics);
        localStages.push(stage);
        break;
      case 'lookup': {
        const lookupStage = compileLookupStage(
          stage,
          aliases,
          availableRowAliases,
          scalarAliases,
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
        validateAliases(stage, scalarAliases, providers, diagnostics);
        returnStage = stage;
        returnLine = stage.line;
        break;
      case 'unsupported':
        diagnostics.push(
          error('FDQL_UNKNOWN_STAGE', `Unsupported FDQL stage: ${stage.text}.`, stage.line),
        );
        break;
    }
  }

  if (!returnStage) {
    returnStage = {
      column: ast.from.column,
      items: [{ expression: { kind: 'wildcard' }, label: '*' }],
      kind: 'return',
      line: ast.from.line,
      range: ast.from.range,
    };
  }

  if (
    !providerLimit && !preamble.settings.allowUnboundedReads
    && !sourceDialect?.hasBoundedPredicate?.(providerPredicate, rowAlias)
  ) {
    diagnostics.push(error(
      'FDQL_UNBOUNDED_PROVIDER_READ',
      'Add provider limit, query by document id, or set fdql.allowUnboundedReads = true.',
      ast.from.line,
    ));
  }

  const sourceValue = sourceAlias?.kind === 'source' ? sourceAlias : undefined;
  if (sourceValue?.binding) {
    diagnostics.push(
      error(
        'FDQL_INVALID_FROM_SOURCE',
        'Parent-bound subcollection sources can only be used in lookup.',
        ast.from.line,
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
      aliases: scalarAliases,
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

function compileLookupStage(
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
  if (!sourceAlias) {
    return null;
  }
  if (stage.required && stage.mode !== 'one') {
    diagnostics.push(
      error(
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
          error(
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
      error(
        'FDQL_UNDECLARED_ALIAS',
        `Source alias ${stage.sourceAlias} is not declared.`,
        stage.line,
      ),
    );
    return null;
  }
  if (sourceAlias.kind !== 'source') {
    diagnostics.push(
      error(
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
      error(
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
      error(
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
      error('FDQL_UNKNOWN_NAMESPACE', `Unknown provider namespace ${namespace}.`, stage.line),
    );
    return null;
  }
  if (!provider.resolveSourceExpression) {
    diagnostics.push(
      error(
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
        error(
          'FDQL_INVALID_LOOKUP_PARENT',
          '`of parent` is only valid with a parent-bound subcollection source.',
          stage.line,
        ),
      );
      return null;
    }
    if (binding.expression) {
      diagnostics.push(
        error(
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
      error(
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
    error(
      'FDQL_INVALID_LOOKUP_PARENT',
      'Subcollection parent must be an existing provider row alias.',
      line,
    ),
  );
}

function validateStageProvider(
  stageProvider: string,
  sourceProvider: string | undefined,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  line: number,
): boolean {
  if (!providers[stageProvider]) {
    diagnostics.push(
      error('FDQL_UNKNOWN_NAMESPACE', `Unknown provider namespace ${stageProvider}.`, line),
    );
    return false;
  }
  if (sourceProvider && stageProvider !== sourceProvider) {
    diagnostics.push(
      error(
        'FDQL_PROVIDER_MISMATCH',
        `Provider clause ${stageProvider} does not match source provider ${sourceProvider}.`,
        line,
      ),
    );
    return false;
  }
  return true;
}

function resolveLookupCacheTtl(
  stage: FdqlLookupStage,
  diagnostics: FdqlDiagnostic[],
): number | undefined {
  if (!stage.cacheTtlRaw) return undefined;
  if (stage.cache !== 'persistent') {
    diagnostics.push(
      error(
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
      error('FDQL_INVALID_LOOKUP_CACHE', 'Invalid lookup cache TTL.', stage.line),
    );
  }
  return cacheTtlMs;
}

function resolveSettings(
  declarations: readonly FdqlSetDeclaration[],
  options: FdqlCompileOptions,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): ResolvedPreambleSettings {
  let settings: FdqlExecutionSettings = { ...defaultSettings, ...options.executionDefaults };
  let providerContext = defaultProviderContext(options);
  const seenKeys = new Map<string, number>();
  for (const declaration of declarations) {
    const parsedKey = parseSettingKey(declaration.key, declaration.line, diagnostics);
    if (!parsedKey) continue;
    const firstLine = seenKeys.get(declaration.key);
    if (firstLine !== undefined) {
      diagnostics.push(
        error(
          'FDQL_DUPLICATE_SET',
          `set ${declaration.key} can only appear once. First used on line ${firstLine}.`,
          declaration.line,
        ),
      );
      continue;
    }
    seenKeys.set(declaration.key, declaration.line);
    if (parsedKey.namespace === 'fdql') {
      settings = applyFdqlSetting(parsedKey.key, declaration, settings, diagnostics);
      continue;
    }
    const value = evaluateSetValue(declaration, diagnostics);
    if (!value) continue;
    const provider = providers[parsedKey.namespace];
    if (!provider) {
      diagnostics.push(
        error(
          'FDQL_UNKNOWN_NAMESPACE',
          `Unknown provider namespace ${parsedKey.namespace}.`,
          declaration.line,
        ),
      );
      continue;
    }
    const resolved = provider.resolveSetting?.({
      diagnostics,
      key: parsedKey.key,
      line: declaration.line,
      value,
    });
    if (resolved) {
      providerContext = mergeProviderContext(providerContext, parsedKey.namespace, resolved);
    } else if (!provider.resolveSetting) {
      diagnostics.push(
        error('FDQL_UNKNOWN_SET_KEY', `Unknown set key ${declaration.key}.`, declaration.line),
      );
    }
  }
  return { providerContext, settings };
}

function parseSettingKey(
  key: string,
  line: number,
  diagnostics: FdqlDiagnostic[],
): { readonly key: string; readonly namespace: string; } | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)$/.exec(key);
  if (!match) {
    diagnostics.push(
      error('FDQL_INVALID_SET_KEY', 'set keys must use namespace.key syntax.', line),
    );
    return null;
  }
  return { key: match[2]!, namespace: match[1]! };
}

function evaluateSetValue(
  declaration: FdqlSetDeclaration,
  diagnostics: FdqlDiagnostic[],
): FdqlValue | null {
  if (!declaration.value) {
    diagnostics.push(
      error(
        'FDQL_INVALID_SET',
        `Invalid value for set ${declaration.key}.`,
        declaration.line,
      ),
    );
    return null;
  }
  if (!isSetValueExpression(declaration.value)) {
    diagnostics.push(
      error(
        'FDQL_INVALID_SET',
        `set ${declaration.key} values must be literals, arrays, or maps.`,
        declaration.line,
      ),
    );
    return null;
  }
  if (declaration.value.kind === 'literal') return literalToValue(declaration.value.value);
  if (declaration.value.kind === 'array') {
    return arrayValue(
      declaration.value.items.map((item) =>
        evaluateSetValue({ ...declaration, value: item }, diagnostics) ?? missingValue
      ),
    );
  }
  if (declaration.value.kind === 'map') {
    return mapValue(Object.fromEntries(
      declaration.value.entries.map((entry) => [
        entry.key,
        evaluateSetValue({ ...declaration, value: entry.value }, diagnostics) ?? missingValue,
      ]),
    ));
  }
  return null;
}

function isSetValueExpression(expression: FdqlExpression): boolean {
  if (expression.kind === 'literal') return true;
  if (expression.kind === 'array') return expression.items.every(isSetValueExpression);
  if (expression.kind === 'map') {
    return expression.entries.every((entry) => isSetValueExpression(entry.value));
  }
  return false;
}

function applyFdqlSetting(
  key: string,
  declaration: FdqlSetDeclaration,
  settings: FdqlExecutionSettings,
  diagnostics: FdqlDiagnostic[],
): FdqlExecutionSettings {
  const line = declaration.line;
  const rawValue = declaration.rawValue.trim();
  if (key === 'readBudget') {
    const value = numericSetValue(declaration, diagnostics);
    if (value && Number.isInteger(value) && value > 0) return { ...settings, readBudget: value };
    diagnostics.push(error('FDQL_INVALID_SET', 'Invalid value for set fdql.readBudget.', line));
  } else if (key === 'timeout') {
    const timeoutMs = parseDurationMs(rawValue);
    if (timeoutMs) return { ...settings, timeoutMs };
    else diagnostics.push(error('FDQL_INVALID_SET', 'Invalid value for set fdql.timeout.', line));
  } else if (key === 'cache') {
    const cacheMode = rawValue.toLowerCase();
    if (cacheMode === 'off' || cacheMode === 'run' || cacheMode === 'persistent') {
      return { ...settings, cache: cacheMode };
    }
    diagnostics.push(error('FDQL_INVALID_SET', 'Invalid value for set fdql.cache.', line));
  } else if (key === 'cacheTtl') {
    const cacheTtlMs = parseCacheTtlMs(rawValue);
    if (cacheTtlMs) return { ...settings, cacheTtlMs };
    diagnostics.push(error('FDQL_INVALID_SET', 'Invalid value for set fdql.cacheTtl.', line));
  } else if (key === 'allowUnboundedReads') {
    const value = scalarSetValue(declaration, diagnostics);
    if (typeof value === 'boolean') return { ...settings, allowUnboundedReads: value };
    diagnostics.push(
      error('FDQL_INVALID_SET', 'Invalid value for set fdql.allowUnboundedReads.', line),
    );
  } else if (!['allowUnboundedReads', 'cache', 'cacheTtl', 'readBudget', 'timeout'].includes(key)) {
    diagnostics.push(error('FDQL_UNKNOWN_SET_KEY', `Unknown set key fdql.${key}.`, line));
  } else {
    diagnostics.push(error('FDQL_INVALID_SET', `Invalid value for set fdql.${key}.`, line));
  }
  return settings;
}

function numericSetValue(
  declaration: FdqlSetDeclaration,
  diagnostics: FdqlDiagnostic[],
): number | undefined {
  const value = scalarSetValue(declaration, diagnostics);
  return typeof value === 'number' ? value : undefined;
}

function scalarSetValue(
  declaration: FdqlSetDeclaration,
  diagnostics: FdqlDiagnostic[],
): ReturnType<typeof scalarValue> | undefined {
  const value = evaluateSetValue(declaration, diagnostics);
  return value ? scalarValue(value) : undefined;
}

function cloneProviderContext(context: FdqlDefaultProviderContext): FdqlDefaultProviderContext {
  return Object.fromEntries(
    Object.entries(context).map(([namespace, values]) => [namespace, { ...values }]),
  );
}

function mergeProviderContext(
  context: FdqlDefaultProviderContext,
  namespace: string,
  values: Readonly<Record<string, unknown>>,
): FdqlDefaultProviderContext {
  return {
    ...context,
    [namespace]: {
      ...context[namespace],
      ...values,
    },
  };
}

function resolveAliases(
  declarations: readonly FdqlAliasDeclaration[],
  context: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): Readonly<Record<string, ResolvedAliasValue>> {
  const aliases: Record<string, ResolvedAliasValue> = {};
  for (const declaration of declarations) {
    if (!/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(declaration.name)) {
      diagnostics.push(
        error('FDQL_INVALID_ALIAS_NAME', 'Alias names must start with `$`.', declaration.line),
      );
      continue;
    }
    if (aliases[declaration.name]) {
      diagnostics.push(
        error(
          'FDQL_INVALID_ALIAS_NAME',
          `Alias ${declaration.name} is already declared.`,
          declaration.line,
        ),
      );
      continue;
    }
    const source = resolveSourceAlias(declaration, aliases, context, providers, diagnostics);
    if (source) {
      aliases[declaration.name] = source;
      continue;
    }
    validateExpressionAliases(declaration.value, aliases, providers, diagnostics, declaration.line);
    aliases[declaration.name] = {
      kind: 'value',
      value: evaluateAliasValue(declaration.value, aliases, providers),
    };
  }
  return aliases;
}

function resolveSourceAlias(
  declaration: FdqlAliasDeclaration,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  context: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  if (declaration.value.kind !== 'call') return null;
  const namespace = providerNamespaceFromCall(declaration.value.name);
  if (!namespace) return null;
  const provider = providers[namespace];
  if (!provider) {
    diagnostics.push(
      error('FDQL_UNKNOWN_NAMESPACE', `Unknown provider namespace ${namespace}.`, declaration.line),
    );
    return null;
  }
  return provider.resolveSourceAlias({
    aliases,
    declaration,
    defaultProviderContext: context,
    diagnostics,
  });
}

function evaluateAliasValue(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  providers: FdqlProviderDialectRegistry,
): FdqlValue {
  if (expression.kind === 'alias') {
    const value = aliases[expression.name];
    return value?.kind === 'value' ? value.value : missingValue;
  }
  if (expression.kind === 'array') {
    return arrayValue(expression.items.map((item) => evaluateAliasValue(item, aliases, providers)));
  }
  if (expression.kind === 'map') {
    return mapValue(Object.fromEntries(
      expression.entries.map((
        entry,
      ) => [entry.key, evaluateAliasValue(entry.value, aliases, providers)]),
    ));
  }
  if (expression.kind === 'literal') return literalToValue(expression.value);
  return evaluateExpression(expression, { providers });
}

function validateAliases(
  stage: FdqlStage,
  aliases: Readonly<Record<string, FdqlValue>>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): void {
  if (stage.kind === 'filter') {
    validateExpressionAliases(stage.expression, aliases, providers, diagnostics, stage.line);
  }
  if (stage.kind === 'sortBy') {
    validateExpressionAliases(stage.expression, aliases, providers, diagnostics, stage.line);
  }
  if (stage.kind === 'unwind') {
    validateExpressionAliases(stage.expression, aliases, providers, diagnostics, stage.line);
  }
  if (stage.kind === 'with' || stage.kind === 'return') {
    for (const item of stage.items) {
      validateExpressionAliases(item.expression, aliases, providers, diagnostics, stage.line);
    }
  }
}

function validateAggregateStage(
  stage: Extract<FdqlStage, { readonly kind: 'aggregate'; }>,
  aliases: Readonly<Record<string, FdqlValue>>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): void {
  for (const group of stage.groups) {
    validateExpressionAliases(group.expression, aliases, providers, diagnostics, stage.line);
  }
  for (const item of stage.items) {
    if (item.expression.kind !== 'call' || !localAggregateCalls.has(item.expression.name)) {
      diagnostics.push(
        error(
          'FDQL_UNSUPPORTED_AGGREGATE',
          'Aggregate expressions must use count(), sum(...), avg(...), min(...), or max(...).',
          stage.line,
        ),
      );
      continue;
    }
    for (const arg of item.expression.args) {
      validateExpressionAliases(arg, aliases, providers, diagnostics, stage.line);
    }
  }
}

function validateExpressionAliases(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, unknown>>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  walkExpression(expression, (node) => {
    if (node.kind === 'alias' && !(node.name in aliases)) {
      diagnostics.push(error('FDQL_UNDECLARED_ALIAS', `Alias ${node.name} is not declared.`, line));
    }
    if (node.kind === 'call') {
      validateExpressionCall(node.name, providers, diagnostics, line);
    }
  });
}

function validateExpressionCall(
  name: string,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (supportedExpressionCalls.has(name)) return;
  const namespace = providerNamespaceFromCall(name);
  if (namespace) {
    const provider = providers[namespace];
    if (!provider) {
      diagnostics.push(
        error('FDQL_UNKNOWN_NAMESPACE', `Unknown provider namespace ${namespace}.`, line),
      );
      return;
    }
    if (provider.valueFunctions.has(name)) return;
  }
  diagnostics.push(error('FDQL_UNKNOWN_FUNCTION', `Unknown FDQL function ${name}.`, line));
}

function parseDurationMs(value: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  const unit = match[2]!.toLowerCase();
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60_000;
  if (unit === 'h') return amount * 3_600_000;
  return amount * 86_400_000;
}

function parseCacheTtlMs(value: string): number | undefined {
  const durationMs = parseDurationMs(value);
  if (!durationMs || durationMs > maxCacheTtlMs) return undefined;
  return durationMs;
}

function walkExpression(
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
  } else if (expression.kind === 'unary') {
    walkExpression(expression.expression, visit, expression);
  } else if (expression.kind === 'binary') {
    walkExpression(expression.left, visit, expression);
    walkExpression(expression.right, visit, expression);
  }
}

function error(code: string, message: string, line?: number): FdqlDiagnostic {
  return { code, ...(line ? { line } : {}), message, severity: 'error' };
}

function duplicateStage(stage: string, firstLine: number, duplicateLine: number): FdqlDiagnostic {
  return error(
    'FDQL_DUPLICATE_STAGE',
    `${stage} can only appear once for the current provider source. First used on line ${firstLine}.`,
    duplicateLine,
  );
}

const supportedExpressionCalls = new Set([
  'bytes',
  'entries',
  'geoPoint',
  'lower',
  'mapGet',
  'timestamp',
]);

const localAggregateCalls = new Set(['avg', 'count', 'max', 'min', 'sum']);

function isUnionAst(ast: FdqlAst): ast is FdqlUnionProgram {
  return 'kind' in ast && ast.kind === 'union';
}

function clearCacheCommandStage(ast: FdqlAst): ClearCacheCommandStage | null {
  const stages = isUnionAst(ast) ? ast.branches.flatMap((branch) => branch.stages) : ast.stages;
  return stages.find((stage): stage is ClearCacheCommandStage =>
    stage.kind === 'unsupported' && /^clear\s+cache\b/i.test(stage.text)
  ) ?? null;
}

function isStandaloneCommand(
  ast: FdqlProgram,
  commandStage: ClearCacheCommandStage,
): boolean {
  return ast.aliases.length === 0
    && ast.settings.length === 0
    && !ast.from
    && ast.stages.length === 1
    && ast.stages[0] === commandStage;
}

function parseClearCacheCommand(
  stage: ClearCacheCommandStage,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlClearCacheCommandPlan | null {
  const match =
    /^clear\s+cache(?:\s+provider\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+project\s+(?:"([^"]+)"|'([^']+)'))?)?$/i
      .exec(stage.text);
  if (!match) {
    diagnostics.push(error(
      'FDQL_INVALID_COMMAND',
      '`clear cache` supports `clear cache`, `clear cache provider name`, or `clear cache provider name project "project-id"`.',
      stage.line,
    ));
    return null;
  }
  const provider = match[1];
  if (provider && !providers[provider]) {
    diagnostics.push(
      error('FDQL_UNKNOWN_NAMESPACE', `Unknown provider namespace ${provider}.`, stage.line),
    );
    return null;
  }
  const projectId = match[2] ?? match[3];
  return {
    kind: 'clearCache',
    ...(projectId ? { projectId } : {}),
    ...(provider ? { provider } : {}),
  };
}

function isReservedCommand(text: string): boolean {
  return /^clear\s+cache(?:\s+provider\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+project\s+(?:"[^"]+"|'[^']+'))?)?$/i
    .test(text);
}

function splitUnionAll(source: string): readonly string[] {
  const parts: string[] = [];
  const lines = source.split(/\r?\n/);
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().toLowerCase() === 'union all') {
      parts.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  parts.push(current.join('\n').trim());
  return parts.filter(Boolean);
}

function sharedPreamble(source: string): string {
  const lines = source.split(/\r?\n/);
  const preamble: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      preamble.push(line);
      continue;
    }
    if (trimmed.startsWith('from ')) break;
    preamble.push(line);
  }
  return preamble.join('\n').trim();
}
