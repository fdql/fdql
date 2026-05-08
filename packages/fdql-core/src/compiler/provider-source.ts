import type {
  FdqlDefaultProviderContext,
  FdqlProviderDialectRegistry,
  FdqlProviderSourceAlias,
} from '../provider.ts';
import { providerNamespaceFromCall } from '../provider.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlLookupStage,
  FdqlProviderAggregateStage,
} from '../types.ts';
import type { ResolvedAliasValue } from './aliases.ts';
import { diagnosticAtName, diagnosticAtRange } from './diagnostics.ts';

type ProviderStage = FdqlLookupStage | FdqlProviderAggregateStage;

export function resolveProviderStageSource(
  stage: ProviderStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  availableRowAliases: ReadonlySet<string>,
  providerContext: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const sourceAlias = stage.sourceExpression
    ? resolveProviderSourceExpression(
      stage,
      aliases,
      availableRowAliases,
      providerContext,
      providers,
      diagnostics,
    )
    : resolveProviderSourceAlias(stage, aliases, diagnostics);
  if (!sourceAlias) return null;
  return applyParent(stage, sourceAlias, availableRowAliases, diagnostics);
}

function resolveProviderSourceAlias(
  stage: ProviderStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const sourceAlias = aliases[stage.sourceAlias];
  if (!sourceAlias) {
    diagnostics.push(
      diagnosticAtName(
        'FDQL_UNDECLARED_ALIAS',
        `Source alias ${stage.sourceAlias} is not declared.`,
        stage.sourceAliasRef,
      ),
    );
    return null;
  }
  if (sourceAlias.kind !== 'source') {
    diagnostics.push(
      diagnosticAtName(
        'FDQL_UNDECLARED_ALIAS',
        `Alias ${stage.sourceAlias} is not a provider source.`,
        stage.sourceAliasRef,
      ),
    );
    return null;
  }
  return sourceAlias;
}

function resolveProviderSourceExpression(
  stage: ProviderStage,
  aliases: Readonly<Record<string, ResolvedAliasValue>>,
  availableRowAliases: ReadonlySet<string>,
  providerContext: FdqlDefaultProviderContext,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const expression = stage.sourceExpression;
  if (!expression || expression.kind !== 'call') {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_PROVIDER_SOURCE',
        `${stageLabel(stage)} source must be a source alias or provider source call.`,
        stage.sourceAliasRef?.range ?? stage.range,
      ),
    );
    return null;
  }
  const namespace = providerNamespaceFromCall(expression.name);
  if (!namespace) {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_PROVIDER_SOURCE',
        `${stageLabel(stage)} source must be a provider source call.`,
        expression.nameRange ?? expression.range,
      ),
    );
    return null;
  }
  const provider = providers[namespace];
  if (!provider) {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_UNKNOWN_NAMESPACE',
        `Unknown provider namespace ${namespace}.`,
        expression.nameRange ?? expression.range,
      ),
    );
    return null;
  }
  if (!provider.resolveSourceExpression) {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_PROVIDER_SOURCE',
        `Provider ${namespace} does not support inline provider sources.`,
        expression.nameRange ?? expression.range,
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

function applyParent(
  stage: ProviderStage,
  sourceAlias: FdqlProviderSourceAlias,
  availableRowAliases: ReadonlySet<string>,
  diagnostics: FdqlDiagnostic[],
): FdqlProviderSourceAlias | null {
  const binding = sourceAlias.binding;
  if (stage.parent) {
    if (!binding || binding.kind !== 'parent') {
      diagnostics.push(
        parentError('`of parent` is only valid with a parent-bound subcollection source.', stage),
      );
      return null;
    }
    if (binding.expression) {
      diagnostics.push(
        parentError(
          '`of parent` is invalid because the provider source already has a parent.',
          stage,
        ),
      );
      return null;
    }
    validateParentExpression(stage, stage.parent, availableRowAliases, diagnostics);
    return { ...sourceAlias, binding: { kind: 'parent', expression: stage.parent } };
  }
  if (binding?.kind === 'parent' && !binding.expression) {
    diagnostics.push(
      parentError(`Subcollection source ${stage.sourceAlias} needs \`of parent\`.`, stage),
    );
    return null;
  }
  if (binding?.kind === 'parent' && binding.expression) {
    validateParentExpression(stage, binding.expression, availableRowAliases, diagnostics);
  }
  return sourceAlias;
}

function validateParentExpression(
  stage: ProviderStage,
  expression: FdqlExpression,
  availableRowAliases: ReadonlySet<string>,
  diagnostics: FdqlDiagnostic[],
): void {
  if (
    expression.kind === 'field' && expression.path.length === 1
    && availableRowAliases.has(expression.path[0] ?? '')
  ) {
    return;
  }
  diagnostics.push(
    diagnosticAtRange(
      parentErrorCode(stage),
      'Subcollection parent must be an existing provider row alias.',
      expression.range ?? stage.range,
    ),
  );
}

function parentError(message: string, stage: ProviderStage): FdqlDiagnostic {
  return diagnosticAtRange(
    parentErrorCode(stage),
    message,
    stage.sourceAliasRef?.range ?? stage.range,
  );
}

function parentErrorCode(stage: ProviderStage): string {
  return stage.kind === 'lookup' ? 'FDQL_INVALID_LOOKUP_PARENT' : 'FDQL_INVALID_PROVIDER_PARENT';
}

function stageLabel(stage: ProviderStage): string {
  return stage.kind === 'lookup' ? 'Lookup' : 'Provider aggregate';
}
