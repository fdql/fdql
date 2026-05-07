import type { FdqlProviderDialectRegistry } from '../provider.ts';
import type { FdqlDiagnostic, FdqlLocalPlanStage, FdqlStage, FdqlValue } from '../types.ts';
import { validateAggregateStage, validateAliases } from './expression-validation.ts';

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
    validateAliases(stage, aliases, providers, diagnostics);
    if (stage.kind === 'unwind') availableRowAliases.add(stage.rowAlias);
    return stage;
  }
  if (stage.kind === 'aggregate') {
    validateAggregateStage(stage, aliases, providers, diagnostics);
    return stage;
  }
  return null;
}
