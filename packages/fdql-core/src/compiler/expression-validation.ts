import type { FdqlProviderDialectRegistry } from '../provider.ts';
import { providerNamespaceFromCall } from '../provider.ts';
import type { FdqlDiagnostic, FdqlExpression, FdqlStage, FdqlValue } from '../types.ts';
import { compilerError } from './diagnostics.ts';

const supportedExpressionCalls = new Set([
  'bytes',
  'entries',
  'geoPoint',
  'lower',
  'mapGet',
  'timestamp',
]);

const localAggregateCalls = new Set(['avg', 'count', 'max', 'min', 'sum']);

export function validateStageProvider(
  stageProvider: string,
  sourceProvider: string | undefined,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  line: number,
): boolean {
  if (!providers[stageProvider]) {
    diagnostics.push(
      compilerError('FDQL_UNKNOWN_NAMESPACE', `Unknown provider namespace ${stageProvider}.`, line),
    );
    return false;
  }
  if (sourceProvider && stageProvider !== sourceProvider) {
    diagnostics.push(
      compilerError(
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

export function validateAggregateStage(
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
        compilerError(
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

export function validateExpressionAliases(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, unknown>>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  walkExpression(expression, (node) => {
    if (node.kind === 'alias' && !(node.name in aliases)) {
      diagnostics.push(
        compilerError('FDQL_UNDECLARED_ALIAS', `Alias ${node.name} is not declared.`, line),
      );
    }
    if (node.kind === 'call') {
      validateExpressionCall(node.name, providers, diagnostics, line);
    }
  });
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
  } else if (expression.kind === 'unary') {
    walkExpression(expression.expression, visit, expression);
  } else if (expression.kind === 'binary') {
    walkExpression(expression.left, visit, expression);
    walkExpression(expression.right, visit, expression);
  }
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
        compilerError('FDQL_UNKNOWN_NAMESPACE', `Unknown provider namespace ${namespace}.`, line),
      );
      return;
    }
    if (provider.valueFunctions.has(name)) return;
  }
  diagnostics.push(compilerError('FDQL_UNKNOWN_FUNCTION', `Unknown FDQL function ${name}.`, line));
}
