import { evaluateExpression } from './evaluator.ts';
import { parseFdql } from './parser.ts';
import type {
  FdqlAliasDeclaration,
  FdqlCompileOptions,
  FdqlDiagnostic,
  FdqlExecutionSettings,
  FdqlExpression,
  FdqlFieldMaskField,
  FdqlLocalPlanStage,
  FdqlLookupPlanStage,
  FdqlLookupStage,
  FdqlNativeOrderBy,
  FdqlReadCompileResult,
  FdqlReturnStage,
  FdqlSetDeclaration,
  FdqlSourcePlan,
  FdqlStage,
  FdqlValue,
} from './types.ts';

const defaultSettings: FdqlExecutionSettings = {
  allowUnboundedReads: false,
  cache: 'off',
  pageSize: 100,
  readBudget: 5000,
  timeoutMs: 60_000,
};

type SourceAliasValue = {
  readonly fieldMask?: readonly FdqlFieldMaskField[] | undefined;
  readonly kind: 'source';
  readonly source: FdqlSourcePlan;
};

type ScalarAliasValue = {
  readonly kind: 'value';
  readonly value: FdqlValue;
};

type ResolvedAliasValue = ScalarAliasValue | SourceAliasValue;

export function compileFdqlRead(
  source: string,
  options: FdqlCompileOptions,
): FdqlReadCompileResult {
  const parsed = parseFdql(source);
  const diagnostics: FdqlDiagnostic[] = [...parsed.diagnostics];
  const ast = parsed.ast;
  if (!ast || !parsed.ok) return { ast, diagnostics, ok: false };

  const settings = resolveSettings(ast.settings, options, diagnostics);
  const aliases = resolveAliases(ast.aliases, options, diagnostics);
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
      `Alias ${ast.from.sourceAlias} is not a Firestore source.`,
      ast.from.line,
    ));
  }

  const rowAlias = ast.from.rowAlias;
  const availableRowAliases = new Set([rowAlias]);
  const localStages: FdqlLocalPlanStage[] = [];
  let nativePredicate: FdqlExpression | undefined;
  let nativeOrderBy: FdqlNativeOrderBy | undefined;
  let nativeOrderByLine: number | undefined;
  let nativeLimit: number | undefined;
  let nativeLimitLine: number | undefined;
  let returnStage: FdqlReturnStage | undefined;
  let returnLine: number | undefined;

  for (const stage of ast.stages) {
    switch (stage.kind) {
      case 'fsWhere':
        validateNativeExpression(
          stage.expression,
          rowAlias,
          scalarAliases,
          diagnostics,
          stage.line,
        );
        nativePredicate = nativePredicate
          ? { kind: 'binary', left: nativePredicate, operator: 'and', right: stage.expression }
          : stage.expression;
        break;
      case 'fsOrderBy':
        if (nativeOrderByLine !== undefined) {
          diagnostics.push(duplicateStage('fs order by', nativeOrderByLine, stage.line));
          break;
        }
        validateNativeOrderBy(stage.expression, rowAlias, diagnostics, stage.line);
        nativeOrderBy = { direction: stage.direction, expression: stage.expression };
        nativeOrderByLine = stage.line;
        break;
      case 'fsLimit':
        if (nativeLimitLine !== undefined) {
          diagnostics.push(duplicateStage('fs limit', nativeLimitLine, stage.line));
          break;
        }
        if (!Number.isInteger(stage.value) || stage.value <= 0) {
          diagnostics.push(
            error('FDQL_PARSE_ERROR', '`fs limit` must be a positive integer.', stage.line),
          );
        }
        nativeLimit = stage.value;
        nativeLimitLine = stage.line;
        break;
      case 'filter':
      case 'take':
      case 'unwind':
      case 'with':
        validateAliases(stage, scalarAliases, diagnostics);
        localStages.push(stage);
        if (stage.kind === 'unwind') availableRowAliases.add(stage.rowAlias);
        break;
      case 'lookup': {
        const lookupStage = compileLookupStage(
          stage,
          aliases,
          availableRowAliases,
          scalarAliases,
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
        validateAliases(stage, scalarAliases, diagnostics);
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
    !nativeLimit && !settings.allowUnboundedReads
    && !hasBoundedIdPredicate(nativePredicate, rowAlias)
  ) {
    diagnostics.push(error(
      'FDQL_UNBOUNDED_PROVIDER_READ',
      'Add `fs limit`, query by document id, or set allowUnboundedReads = true.',
      ast.from.line,
    ));
  }

  const sourceValue = sourceAlias?.kind === 'source' ? sourceAlias : undefined;
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
      native: {
        ...(sourceValue.fieldMask ? { fieldMask: sourceValue.fieldMask } : {}),
        ...(nativeLimit === undefined ? {} : { limit: nativeLimit }),
        ...(nativeOrderBy ? { orderBy: nativeOrderBy } : {}),
        ...(nativePredicate ? { predicate: nativePredicate } : {}),
        source: sourceValue.source,
      },
      returnStage,
      rowAlias,
      settings,
    },
  };
}

function compileLookupStage(
  stage: FdqlLookupStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  availableRowAliases: ReadonlySet<string>,
  scalarAliases: Readonly<Record<string, FdqlValue>>,
  diagnostics: FdqlDiagnostic[],
): FdqlLookupPlanStage | null {
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
        `Alias ${stage.sourceAlias} is not a Firestore source.`,
        stage.line,
      ),
    );
    return null;
  }

  let nativePredicate: FdqlExpression | undefined;
  let nativeOrderBy: FdqlNativeOrderBy | undefined;
  let nativeOrderByLine: number | undefined;
  let nativeLimit: number | undefined;
  let nativeLimitLine: number | undefined;
  const rowsForLookup = new Set([...availableRowAliases, stage.rowAlias]);

  for (const clause of stage.clauses) {
    if (clause.kind === 'fsWhere') {
      validateLookupNativeExpression(
        clause.expression,
        stage.rowAlias,
        rowsForLookup,
        scalarAliases,
        diagnostics,
        clause.line,
      );
      nativePredicate = nativePredicate
        ? { kind: 'binary', left: nativePredicate, operator: 'and', right: clause.expression }
        : clause.expression;
    } else if (clause.kind === 'fsOrderBy') {
      if (nativeOrderByLine !== undefined) {
        diagnostics.push(duplicateStage('lookup fs order by', nativeOrderByLine, clause.line));
        continue;
      }
      validateNativeOrderBy(clause.expression, stage.rowAlias, diagnostics, clause.line);
      nativeOrderBy = { direction: clause.direction, expression: clause.expression };
      nativeOrderByLine = clause.line;
    } else if (clause.kind === 'fsLimit') {
      if (nativeLimitLine !== undefined) {
        diagnostics.push(duplicateStage('lookup fs limit', nativeLimitLine, clause.line));
        continue;
      }
      if (!Number.isInteger(clause.value) || clause.value <= 0) {
        diagnostics.push(
          error('FDQL_PARSE_ERROR', '`fs limit` must be a positive integer.', clause.line),
        );
      }
      nativeLimit = clause.value;
      nativeLimitLine = clause.line;
    }
  }

  return {
    column: stage.column,
    kind: 'lookup',
    line: stage.line,
    mode: stage.mode,
    native: {
      ...(sourceAlias.fieldMask ? { fieldMask: sourceAlias.fieldMask } : {}),
      ...(nativeLimit === undefined ? {} : { limit: nativeLimit }),
      ...(nativeOrderBy ? { orderBy: nativeOrderBy } : {}),
      ...(nativePredicate ? { predicate: nativePredicate } : {}),
      source: sourceAlias.source,
    },
    range: stage.range,
    rowAlias: stage.rowAlias,
    sourceAlias: stage.sourceAlias,
  };
}

function resolveSettings(
  declarations: readonly FdqlSetDeclaration[],
  options: FdqlCompileOptions,
  diagnostics: FdqlDiagnostic[],
): FdqlExecutionSettings {
  const settings = { ...defaultSettings, ...options.executionDefaults };
  const keys = new Set(['allowUnboundedReads', 'cache', 'readBudget', 'timeout']);
  for (const declaration of declarations) {
    if (!keys.has(declaration.key)) {
      diagnostics.push(
        error('FDQL_UNKNOWN_SET_KEY', `Unknown set key ${declaration.key}.`, declaration.line),
      );
      continue;
    }
    const value = evaluateExpression(declaration.value) as unknown;
    if (
      declaration.key === 'readBudget'
      && typeof value === 'number'
      && Number.isInteger(value)
      && value > 0
    ) {
      settings.readBudget = value;
    } else if (declaration.key === 'timeout' && typeof value === 'string') {
      settings.timeoutMs = parseDurationMs(value);
    } else if (
      declaration.key === 'cache' && (value === 'off' || value === 'run' || value === 'session')
    ) {
      settings.cache = value;
    } else if (declaration.key === 'allowUnboundedReads' && typeof value === 'boolean') {
      settings.allowUnboundedReads = value;
    } else {
      diagnostics.push(
        error('FDQL_INVALID_SET', `Invalid value for set ${declaration.key}.`, declaration.line),
      );
    }
  }
  return settings;
}

function resolveAliases(
  declarations: readonly FdqlAliasDeclaration[],
  options: FdqlCompileOptions,
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
    const source = resolveSourceAlias(declaration, aliases, options, diagnostics);
    if (source) {
      aliases[declaration.name] = source;
      continue;
    }
    validateExpressionAliases(declaration.value, aliases, diagnostics, declaration.line);
    aliases[declaration.name] = {
      kind: 'value',
      value: evaluateAliasValue(declaration.value, aliases),
    };
  }
  return aliases;
}

function resolveSourceAlias(
  declaration: FdqlAliasDeclaration,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  options: FdqlCompileOptions,
  diagnostics: FdqlDiagnostic[],
): SourceAliasValue | null {
  if (declaration.value.kind !== 'call' || !declaration.value.name.startsWith('fs.')) return null;
  const parts = declaration.value.name.split('.').slice(1);
  const args = [...declaration.value.args];
  let projectId = options.defaultProjectId;
  let databaseId: string | undefined;
  let source: SourceAliasValue | null = null;

  for (const part of parts) {
    if (part === 'project') {
      projectId = readStringArg(args.shift(), aliases, diagnostics, declaration.line, 'fs.project');
      continue;
    }
    if (part === 'db') {
      databaseId = readStringArg(args.shift(), aliases, diagnostics, declaration.line, 'fs.db');
      continue;
    }
    if (part === 'collection' || part === 'collectionGroup') {
      const path = readStringArg(
        args.shift(),
        aliases,
        diagnostics,
        declaration.line,
        `fs.${part}`,
      );
      const fieldMask = args.length
        ? readFieldMask(args.shift(), diagnostics, declaration.line)
        : undefined;
      if (part === 'collection' && !isCollectionPath(path)) {
        diagnostics.push(
          error('FDQL_PARSE_ERROR', `Invalid collection path ${path}.`, declaration.line),
        );
      }
      if (part === 'collectionGroup' && path.includes('/')) {
        diagnostics.push(
          error(
            'FDQL_PARSE_ERROR',
            'fs.collectionGroup accepts a collection id, not a path.',
            declaration.line,
          ),
        );
      }
      source = {
        ...(fieldMask === undefined ? {} : { fieldMask }),
        kind: 'source',
        source: {
          ...(databaseId ? { databaseId } : {}),
          ...(part === 'collection' ? { collectionPath: path } : { collectionGroup: path }),
          projectId,
          sourceAlias: declaration.name,
          type: part,
        },
      };
      continue;
    }
    diagnostics.push(
      error(
        'FDQL_UNKNOWN_NAMESPACE',
        `Unknown Firestore source function ${part}.`,
        declaration.line,
      ),
    );
  }

  if (args.length) {
    diagnostics.push(
      error(
        'FDQL_PARSE_ERROR',
        `Too many arguments for ${declaration.value.name}.`,
        declaration.line,
      ),
    );
  }
  return source;
}

function readStringArg(
  expression: FdqlExpression | undefined,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  diagnostics: FdqlDiagnostic[],
  line: number,
  functionName: string,
): string {
  if (!expression) {
    diagnostics.push(error('FDQL_PARSE_ERROR', `${functionName} needs a string argument.`, line));
    return '';
  }
  const value = evaluateAliasValue(expression, aliases);
  if (typeof value !== 'string') {
    diagnostics.push(error('FDQL_PARSE_ERROR', `${functionName} needs a string argument.`, line));
    return '';
  }
  return value;
}

function readFieldMask(
  expression: FdqlExpression | undefined,
  diagnostics: FdqlDiagnostic[],
  line: number,
): readonly FdqlFieldMaskField[] | undefined {
  if (!expression) return undefined;
  if (expression.kind !== 'array') {
    diagnostics.push(
      error(
        'FDQL_INVALID_FIELD_MASK',
        'Top-level source field masks must be literal arrays.',
        line,
      ),
    );
    return undefined;
  }
  if (expression.items.length > 150) {
    diagnostics.push(
      error('FDQL_INVALID_FIELD_MASK', 'Field masks can include at most 150 fields.', line),
    );
  }
  return expression.items.flatMap((item) => {
    if (item.kind === 'literal' && typeof item.value === 'string') return [{ path: item.value }];
    diagnostics.push(error('FDQL_INVALID_FIELD_MASK', 'Field mask entries must be strings.', line));
    return [];
  });
}

function evaluateAliasValue(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
): FdqlValue {
  if (expression.kind === 'alias') {
    const value = aliases[expression.name];
    return value?.kind === 'value' ? value.value : null;
  }
  if (expression.kind === 'array') {
    return expression.items.map((item) => evaluateAliasValue(item, aliases));
  }
  if (expression.kind === 'map') {
    return Object.fromEntries(
      expression.entries.map((entry) => [entry.key, evaluateAliasValue(entry.value, aliases)]),
    );
  }
  if (expression.kind === 'literal') return expression.value;
  return evaluateExpression(expression) as FdqlValue;
}

function validateAliases(
  stage: FdqlStage,
  aliases: Readonly<Record<string, FdqlValue>>,
  diagnostics: FdqlDiagnostic[],
): void {
  if (stage.kind === 'filter') {
    validateExpressionAliases(stage.expression, aliases, diagnostics, stage.line);
  }
  if (stage.kind === 'unwind') {
    validateExpressionAliases(stage.expression, aliases, diagnostics, stage.line);
  }
  if (stage.kind === 'with' || stage.kind === 'return') {
    for (const item of stage.items) {
      validateExpressionAliases(item.expression, aliases, diagnostics, stage.line);
    }
  }
}

function validateExpressionAliases(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, unknown>>,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  walkExpression(expression, (node) => {
    if (node.kind === 'alias' && !(node.name in aliases)) {
      diagnostics.push(error('FDQL_UNDECLARED_ALIAS', `Alias ${node.name} is not declared.`, line));
    }
    if (node.kind === 'call') {
      validateExpressionCall(node.name, diagnostics, line);
    }
  });
}

function validateExpressionCall(
  name: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (supportedExpressionCalls.has(name)) return;
  diagnostics.push(error('FDQL_UNKNOWN_FUNCTION', `Unknown FDQL function ${name}.`, line));
}

function validateNativeExpression(
  expression: FdqlExpression,
  rowAlias: string,
  aliases: Readonly<Record<string, FdqlValue>>,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  validateExpressionAliases(expression, aliases, diagnostics, line);
  validateNativePredicate(expression, rowAlias, diagnostics, line);
  walkExpression(expression, (node, parent) => {
    if (
      node.kind === 'call' && !['fs.id', 'fs.timestamp', 'fs.arrayContains'].includes(node.name)
    ) {
      diagnostics.push(
        error('FDQL_LOCAL_EXPRESSION_IN_FS_CLAUSE', `${node.name} is not valid in fs where.`, line),
      );
    }
    if (node.kind === 'field' && !isMetadataRowArgument(node, parent, rowAlias)) {
      validateProviderField(node.path, rowAlias, diagnostics, line);
    }
  });
}

function validateLookupNativeExpression(
  expression: FdqlExpression,
  lookupRowAlias: string,
  availableRowAliases: ReadonlySet<string>,
  aliases: Readonly<Record<string, FdqlValue>>,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  validateExpressionAliases(expression, aliases, diagnostics, line);
  validateLookupNativePredicate(expression, lookupRowAlias, diagnostics, line);
  walkExpression(expression, (node, parent) => {
    if (
      node.kind === 'call'
      && !['fs.id', 'fs.timestamp', 'fs.arrayContains'].includes(node.name)
    ) {
      diagnostics.push(
        error(
          'FDQL_LOCAL_EXPRESSION_IN_FS_CLAUSE',
          `${node.name} is not valid in lookup fs where.`,
          line,
        ),
      );
    }
    if (node.kind === 'field' && !isMetadataArgument(node, parent)) {
      const binding = node.path[0];
      if (!binding || !availableRowAliases.has(binding)) {
        diagnostics.push(error('FDQL_UNKNOWN_BINDING', `Unknown row binding ${binding}.`, line));
      }
    }
  });
}

function validateNativePredicate(
  expression: FdqlExpression,
  rowAlias: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (
    expression.kind === 'binary' && (expression.operator === 'and' || expression.operator === 'or')
  ) {
    validateNativePredicate(expression.left, rowAlias, diagnostics, line);
    validateNativePredicate(expression.right, rowAlias, diagnostics, line);
    return;
  }
  if (expression.kind === 'binary') {
    if (!isProviderOperand(expression.left, rowAlias)) {
      diagnostics.push(
        error(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs where` comparisons need a provider field on the left.',
          line,
        ),
      );
    }
    if (!isNativeValueExpression(expression.right)) {
      diagnostics.push(
        error(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs where` comparison values must be literals, aliases, arrays, maps, or fs.timestamp(...).',
          line,
        ),
      );
    }
    return;
  }
  if (expression.kind === 'call' && expression.name === 'fs.arrayContains') {
    if (
      !isProviderOperand(expression.args[0], rowAlias)
      || !isNativeValueExpression(expression.args[1])
    ) {
      diagnostics.push(
        error(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs.arrayContains` needs a provider field and a provider value.',
          line,
        ),
      );
    }
    return;
  }
  diagnostics.push(
    error('FDQL_UNSUPPORTED_FS_WHERE', '`fs where` needs provider comparison predicates.', line),
  );
}

function validateLookupNativePredicate(
  expression: FdqlExpression,
  lookupRowAlias: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (
    expression.kind === 'binary' && (expression.operator === 'and' || expression.operator === 'or')
  ) {
    validateLookupNativePredicate(expression.left, lookupRowAlias, diagnostics, line);
    validateLookupNativePredicate(expression.right, lookupRowAlias, diagnostics, line);
    return;
  }
  if (expression.kind === 'binary') {
    if (!isProviderOperand(expression.left, lookupRowAlias)) {
      diagnostics.push(
        error(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`lookup` fs where comparisons need the lookup provider field on the left.',
          line,
        ),
      );
    }
    return;
  }
  if (expression.kind === 'call' && expression.name === 'fs.arrayContains') {
    if (!isProviderOperand(expression.args[0], lookupRowAlias)) {
      diagnostics.push(
        error(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs.arrayContains` needs a lookup provider field.',
          line,
        ),
      );
    }
    return;
  }
  diagnostics.push(
    error('FDQL_UNSUPPORTED_FS_WHERE', '`lookup` fs where needs provider predicates.', line),
  );
}

function validateNativeOrderBy(
  expression: FdqlExpression,
  rowAlias: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (expression.kind === 'field') {
    validateProviderField(expression.path, rowAlias, diagnostics, line);
    return;
  }
  if (expression.kind === 'call' && expression.name === 'fs.id') return;
  diagnostics.push(
    error('FDQL_UNSUPPORTED_FS_ORDER_BY', '`fs order by` needs a provider field.', line),
  );
}

function validateProviderField(
  path: readonly string[],
  rowAlias: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (path.length === 1) {
    diagnostics.push(
      error(
        'FDQL_UNQUALIFIED_PROVIDER_FIELD',
        `Provider field ${path[0]} must be qualified.`,
        line,
      ),
    );
  } else if (path[0] !== rowAlias) {
    diagnostics.push(
      error('FDQL_UNKNOWN_BINDING', `Unknown provider row binding ${path[0]}.`, line),
    );
  }
}

function hasBoundedIdPredicate(expression: FdqlExpression | undefined, rowAlias: string): boolean {
  if (!expression) return false;
  if (expression.kind === 'binary' && expression.operator === 'and') {
    return hasBoundedIdPredicate(expression.left, rowAlias)
      || hasBoundedIdPredicate(expression.right, rowAlias);
  }
  if (expression.kind !== 'binary' || expression.operator !== '=') return false;
  return isIdCall(expression.left, rowAlias) || isIdCall(expression.right, rowAlias);
}

function isIdCall(expression: FdqlExpression, rowAlias: string): boolean {
  return expression.kind === 'call'
    && expression.name === 'fs.id'
    && expression.args[0]?.kind === 'field'
    && expression.args[0].path.length === 1
    && expression.args[0].path[0] === rowAlias;
}

function isProviderOperand(
  expression: FdqlExpression | undefined,
  rowAlias: string,
): expression is Extract<FdqlExpression, { readonly kind: 'call' | 'field'; }> {
  if (!expression) return false;
  if (expression.kind === 'field') return expression.path[0] === rowAlias;
  return isIdCall(expression, rowAlias);
}

function isNativeValueExpression(expression: FdqlExpression | undefined): boolean {
  if (!expression) return false;
  if (expression.kind === 'literal' || expression.kind === 'alias') return true;
  if (expression.kind === 'array') return expression.items.every(isNativeValueExpression);
  if (expression.kind === 'map') {
    return expression.entries.every((entry) => isNativeValueExpression(entry.value));
  }
  if (expression.kind === 'call' && expression.name === 'fs.timestamp') {
    return expression.args.every(isNativeValueExpression);
  }
  return false;
}

function isMetadataRowArgument(
  expression: Extract<FdqlExpression, { readonly kind: 'field'; }>,
  parent: FdqlExpression | undefined,
  rowAlias: string,
): boolean {
  return parent?.kind === 'call'
    && parent.name === 'fs.id'
    && parent.args[0] === expression
    && expression.path.length === 1
    && expression.path[0] === rowAlias;
}

function isMetadataArgument(
  expression: Extract<FdqlExpression, { readonly kind: 'field'; }>,
  parent: FdqlExpression | undefined,
): boolean {
  return parent?.kind === 'call'
    && ['fs.id', 'fs.path', 'fs.projectId'].includes(parent.name)
    && parent.args[0] === expression
    && expression.path.length === 1;
}

function isCollectionPath(path: string): boolean {
  return Boolean(path) && path.split('/').filter(Boolean).length % 2 === 1;
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)(ms|s|m)?$/.exec(value.trim());
  if (!match) return defaultSettings.timeoutMs;
  const amount = Number(match[1]);
  if (match[2] === 'ms') return amount;
  if (match[2] === 'm') return amount * 60_000;
  return amount * 1000;
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
  'entries',
  'fs.arrayContains',
  'fs.id',
  'fs.path',
  'fs.projectId',
  'fs.timestamp',
  'lower',
  'mapGet',
]);
