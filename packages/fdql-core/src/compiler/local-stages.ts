import type { FdqlProviderDialectRegistry } from '../provider.ts';
import type { FdqlDiagnostic, FdqlLocalPlanStage, FdqlStage, FdqlValue } from '../types.ts';
import {
  hasWildcardProjection,
  projectionBindingNames,
  validateAggregateStage,
  validateLocalStageExpressions,
} from './expression-validation.ts';

export function compileLocalStage(
  stage: FdqlStage,
  availableRowAliases: Set<string>,
  aliases: Readonly<Record<string, FdqlValue>>,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlLocalPlanStage | null {
  if (
    stage.kind === 'filter' || stage.kind === 'sortBy' || stage.kind === 'take'
    || stage.kind === 'unwind' || stage.kind === 'with'
  ) {
    validateLocalStageExpressions(stage, aliases, availableRowAliases, providers, diagnostics);
    if (stage.kind === 'unwind') availableRowAliases.add(stage.rowAlias);
    if (stage.kind === 'with') {
      replaceRowBindings(
        availableRowAliases,
        nextProjectionBindings(stage.items, availableRowAliases),
      );
    }
    return stage;
  }
  if (stage.kind === 'aggregate') {
    validateAggregateStage(stage, aliases, availableRowAliases, providers, diagnostics);
    replaceRowBindings(
      availableRowAliases,
      projectionBindingNames([...stage.groups, ...stage.items]),
    );
    return stage;
  }
  return null;
}

function nextProjectionBindings(
  items: Extract<FdqlStage, { readonly kind: 'with'; }>['items'],
  current: ReadonlySet<string>,
): readonly string[] {
  const next = hasWildcardProjection(items) ? new Set(current) : new Set<string>();
  for (const name of projectionBindingNames(items)) next.add(name);
  return [...next];
}

function replaceRowBindings(target: Set<string>, next: readonly string[]): void {
  target.clear();
  for (const name of next) target.add(name);
}
