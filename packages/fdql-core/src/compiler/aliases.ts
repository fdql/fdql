import { evaluateExpression } from '../evaluator.ts';
import {
  type FdqlDefaultProviderContext,
  type FdqlProviderDialectRegistry,
  type FdqlProviderSourceAlias,
  type FdqlResolvedAliasValue,
  providerNamespaceFromCall,
} from '../provider.ts';
import type { FdqlAliasDeclaration, FdqlDiagnostic, FdqlExpression, FdqlValue } from '../types.ts';
import { arrayValue, literalToValue, mapValue, missingValue } from '../value.ts';
import { diagnosticAtName, diagnosticAtRange } from './diagnostics.ts';
import { validateExpressionAliases } from './expression-validation.ts';

export type ResolvedAliasValue = FdqlResolvedAliasValue;

export function resolveAliases(
  declarations: readonly FdqlAliasDeclaration[],
  context: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): Readonly<Record<string, ResolvedAliasValue>> {
  const aliases: Record<string, ResolvedAliasValue> = {};
  for (const declaration of declarations) {
    if (!/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(declaration.name)) {
      diagnostics.push(
        diagnosticAtName(
          'FDQL_INVALID_ALIAS_NAME',
          'Alias names must start with `$`.',
          declaration.nameRef,
          declaration.line,
        ),
      );
      continue;
    }
    if (aliases[declaration.name]) {
      diagnostics.push(
        diagnosticAtName(
          'FDQL_INVALID_ALIAS_NAME',
          `Alias ${declaration.name} is already declared.`,
          declaration.nameRef,
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

export function scalarAliases(
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
): Readonly<Record<string, FdqlValue>> {
  return Object.fromEntries(
    Object.entries(aliases).flatMap(([name, value]) =>
      value.kind === 'value' ? [[name, value.value] as const] : []
    ),
  );
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
      diagnosticAtRange(
        'FDQL_UNKNOWN_NAMESPACE',
        `Unknown provider namespace ${namespace}.`,
        declaration.value.nameRange ?? declaration.value.range,
        declaration.line,
      ),
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
