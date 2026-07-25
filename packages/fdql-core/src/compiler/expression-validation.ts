import type { FdqlProviderDialectRegistry } from '../provider.ts';
import { providerNamespaceFromCall } from '../provider.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlProjectionItem,
  FdqlSourceRange,
  FdqlStage,
  FdqlValue,
} from '../types.ts';
import { compilerError, diagnosticAtRange } from './diagnostics.ts';

const supportedExpressionCalls = new Set([
  'bytes',
  'entries',
  'exists',
  'geoPoint',
  'lower',
  'mapGet',
  'missing',
  'timestamp',
]);

const localAggregateCalls = new Set(['avg', 'count', 'max', 'min', 'sum']);

export function validateStageProvider(
  stageProvider: string,
  sourceProvider: string | undefined,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  line: number,
  range?: FdqlSourceRange | undefined,
): boolean {
  if (!providers[stageProvider]) {
    diagnostics.push(
      range
        ? diagnosticAtRange(
          'FDQL_UNKNOWN_NAMESPACE',
          `Unknown provider namespace ${stageProvider}.`,
          range,
        )
        : compilerError(
          'FDQL_UNKNOWN_NAMESPACE',
          `Unknown provider namespace ${stageProvider}.`,
          line,
        ),
    );
    return false;
  }
  if (sourceProvider && stageProvider !== sourceProvider) {
    diagnostics.push(
      range
        ? diagnosticAtRange(
          'FDQL_PROVIDER_MISMATCH',
          `Provider clause ${stageProvider} does not match source provider ${sourceProvider}.`,
          range,
        )
        : compilerError(
          'FDQL_PROVIDER_MISMATCH',
          `Provider clause ${stageProvider} does not match source provider ${sourceProvider}.`,
          line,
        ),
    );
    return false;
  }
  return true;
}

export function validateAliases(
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

export function validateLocalStageExpressions(
  stage: FdqlStage,
  aliases: Readonly<Record<string, FdqlValue>>,
  rowBindings: ReadonlySet<string>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): void {
  if (stage.kind === 'filter') {
    validateExpressionReferences(
      stage.expression,
      aliases,
      rowBindings,
      providers,
      diagnostics,
      stage.line,
      stage.column,
    );
  }
  if (stage.kind === 'sortBy') {
    validateExpressionReferences(
      stage.expression,
      aliases,
      rowBindings,
      providers,
      diagnostics,
      stage.line,
      stage.column,
    );
  }
  if (stage.kind === 'unwind') {
    validateExpressionReferences(
      stage.expression,
      aliases,
      rowBindings,
      providers,
      diagnostics,
      stage.line,
      stage.column,
    );
  }
  if (stage.kind === 'with') {
    validateProjectionReferences(stage.items, aliases, rowBindings, providers, diagnostics, {
      allowSpread: false,
    });
  }
  if (stage.kind === 'return') {
    validateProjectionReferences(stage.items, aliases, rowBindings, providers, diagnostics);
  }
}

export function validateAggregateStage(
  stage: Extract<FdqlStage, { readonly kind: 'aggregate'; }>,
  aliases: Readonly<Record<string, FdqlValue>>,
  rowBindings: ReadonlySet<string>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): void {
  for (const group of stage.groups) {
    validateProjectionSpread(group, false, diagnostics);
    validateExpressionReferences(
      group.expression,
      aliases,
      rowBindings,
      providers,
      diagnostics,
      group.line ?? stage.line,
      group.column ?? stage.column,
    );
  }
  for (const item of stage.items) {
    validateProjectionSpread(item, false, diagnostics);
    if (item.expression.kind !== 'call' || !localAggregateCalls.has(item.expression.name)) {
      diagnostics.push(
        compilerError(
          'FDQL_UNSUPPORTED_AGGREGATE',
          'Aggregate expressions must use count(), sum(...), avg(...), min(...), or max(...).',
          stage.line,
        ),
      );
      continue;
    }
    for (const arg of item.expression.args) {
      validateExpressionReferences(
        arg,
        aliases,
        rowBindings,
        providers,
        diagnostics,
        item.line ?? stage.line,
        item.column ?? stage.column,
      );
    }
  }
}

export function validateProjectionReferences(
  items: readonly FdqlProjectionItem[],
  aliases: Readonly<Record<string, FdqlValue>>,
  rowBindings: ReadonlySet<string>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  options: { readonly allowSpread?: boolean | undefined; } = {},
): void {
  for (const item of items) {
    validateProjectionSpread(item, options.allowSpread !== false, diagnostics);
    validateExpressionReferences(
      item.expression,
      aliases,
      rowBindings,
      providers,
      diagnostics,
      item.line,
      item.column,
    );
  }
}

export function validateExpressionReferences(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, unknown>>,
  rowBindings: ReadonlySet<string>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  line?: number,
  column?: number,
): void {
  validateExpressionAliases(expression, aliases, providers, diagnostics, line ?? 0);
  validateExpressionRowBindings(expression, rowBindings, diagnostics, line, column);
}

export function validateExpressionAliases(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, unknown>>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  _line: number,
): void {
  walkExpression(expression, (node) => {
    if (node.kind === 'alias' && !(node.name in aliases)) {
      diagnostics.push(
        diagnosticAtRange(
          'FDQL_UNDECLARED_ALIAS',
          `Alias ${node.name} is not declared.`,
          node.range,
        ),
      );
    }
    if (node.kind === 'call') {
      validateExpressionCall(node, providers, diagnostics);
    }
  });
}

export function projectionBindingNames(
  items: readonly FdqlProjectionItem[],
): readonly string[] {
  return items.flatMap((item) => {
    if (item.spread || item.expression.kind === 'wildcard') return [];
    return [item.alias ?? labelFor(item.expression, item.label)];
  });
}

export function hasWildcardProjection(items: readonly FdqlProjectionItem[]): boolean {
  return items.some((item) => item.expression.kind === 'wildcard');
}

export function walkExpression(
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
  } else if (expression.kind === 'case') {
    for (const branch of expression.branches) {
      walkExpression(branch.condition, visit, expression);
      walkExpression(branch.value, visit, expression);
    }
    if (expression.elseExpression) walkExpression(expression.elseExpression, visit, expression);
  } else if (expression.kind === 'unary') {
    walkExpression(expression.expression, visit, expression);
  } else if (expression.kind === 'postfix') {
    walkExpression(expression.expression, visit, expression);
  } else if (expression.kind === 'binary') {
    walkExpression(expression.left, visit, expression);
    walkExpression(expression.right, visit, expression);
  }
}

function validateExpressionRowBindings(
  expression: FdqlExpression,
  rowBindings: ReadonlySet<string>,
  diagnostics: FdqlDiagnostic[],
  line?: number,
  column?: number,
): void {
  const seen = new Set<string>();
  walkExpression(expression, (node) => {
    if (node.kind !== 'field') return;
    const root = node.path[0];
    if (!root || rowBindings.has(root) || seen.has(root)) return;
    seen.add(root);
    const diagnosticLine = node.range?.startLine ?? line;
    const diagnosticColumn = node.range?.startColumn ?? column;
    const rootRange = node.range
      ? {
        endColumn: node.range.startColumn + root.length,
        endLine: node.range.startLine,
        startColumn: node.range.startColumn,
        startLine: node.range.startLine,
      }
      : undefined;
    diagnostics.push({
      ...(rootRange
        ? diagnosticAtRange(
          'FDQL_UNKNOWN_ROW_BINDING',
          `Unknown row binding ${root}. Use a current row alias or projected binding such as stats.total.`,
          rootRange,
        )
        : compilerError(
          'FDQL_UNKNOWN_ROW_BINDING',
          `Unknown row binding ${root}. Use a current row alias or projected binding such as stats.total.`,
          diagnosticLine,
          diagnosticColumn,
        )),
      ...(diagnosticColumn
        ? { endColumn: diagnosticColumn + root.length, endLine: diagnosticLine }
        : {}),
    });
  });
}

function validateProjectionSpread(
  item: FdqlProjectionItem,
  allowSpread: boolean,
  diagnostics: FdqlDiagnostic[],
): void {
  if (!item.spread) return;
  if (!allowSpread) {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_SPREAD_PROJECTION',
        'Spread projections are only supported in `return`.',
        item.range,
      ),
    );
  }
  if (item.alias) {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_SPREAD_PROJECTION',
        'Spread return projections cannot use `as alias`.',
        item.aliasRef?.range ?? item.range,
      ),
    );
  }
}

function labelFor(expression: FdqlExpression, fallback: string): string {
  if (expression.kind === 'field') return expression.path.at(-1) ?? fallback;
  if (expression.kind === 'call') return expression.name.split('.').at(-1) ?? fallback;
  return fallback;
}

function validateExpressionCall(
  expression: Extract<FdqlExpression, { readonly kind: 'call'; }>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): void {
  const name = expression.name;
  if (supportedExpressionCalls.has(name)) return;
  const namespace = providerNamespaceFromCall(name);
  if (namespace) {
    const provider = providers[namespace];
    if (!provider) {
      diagnostics.push(
        diagnosticAtRange(
          'FDQL_UNKNOWN_NAMESPACE',
          `Unknown provider namespace ${namespace}.`,
          expression.nameRange ?? expression.range,
        ),
      );
      return;
    }
    if (provider.valueFunctions.has(name)) return;
  }
  diagnostics.push(
    diagnosticAtRange(
      'FDQL_UNKNOWN_FUNCTION',
      `Unknown FDQL function ${name}.`,
      expression.nameRange ?? expression.range,
    ),
  );
}
