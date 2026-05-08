import type { EvalContext } from '../evaluator.ts';
import type { FdqlProviderDialectRegistry, FdqlProviderRuntimeRegistry } from '../provider.ts';
import type {
  EvalRows,
  FdqlProviderAggregatePlan,
  FdqlProviderAggregateRequest,
  FdqlProviderAggregateResult,
  FdqlProviderReadControls,
  FdqlProviderReadPlan,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlSingleReadPlan,
} from '../types.ts';
import { errorWithDiagnosticContext } from './errors.ts';
import type { MutableStats, RowRecord } from './types.ts';

export function createReadRequest(
  provider: FdqlProviderReadPlan,
  plan: FdqlSingleReadPlan,
  rowAlias: string,
  stats: MutableStats,
  stage: 'lookup' | 'source',
  rows?: EvalRows,
  maxOverride?: number,
): FdqlProviderReadRequest {
  const source = provider.source;
  const remainingBudget = Math.max(0, plan.settings.readBudget - stats.reads);
  const maxDocuments = Math.min(
    provider.limit ?? remainingBudget,
    remainingBudget,
    maxOverride ?? remainingBudget,
  );
  return {
    aliases: plan.aliases,
    ...(provider.fieldMask ? { fieldMask: provider.fieldMask } : {}),
    ...(provider.limit === undefined ? {} : { limit: provider.limit }),
    maxDocuments,
    ...(provider.orderBy ? { orderBy: provider.orderBy } : {}),
    pageSize: Math.min(plan.settings.pageSize, maxDocuments),
    ...(provider.predicate ? { predicate: provider.predicate } : {}),
    rowAlias,
    ...(rows ? { rows } : {}),
    source,
    stage,
  };
}

export function createAggregateRequest(
  provider: FdqlProviderReadPlan,
  aggregate: FdqlProviderAggregatePlan,
  plan: FdqlSingleReadPlan,
  stats: MutableStats,
  rows?: EvalRows,
  stage: FdqlProviderAggregateRequest['stage'] = 'lookupAggregate',
): FdqlProviderAggregateRequest {
  const remainingBudget = Math.max(0, plan.settings.readBudget - stats.reads);
  return {
    aggregates: aggregate.items,
    aliases: plan.aliases,
    maxDocuments: remainingBudget,
    ...(provider.predicate ? { predicate: provider.predicate } : {}),
    rowAlias: aggregate.rowAlias,
    ...(rows ? { rows } : {}),
    source: provider.source,
    stage,
  };
}

export async function aggregateProvider(
  runtime: FdqlProviderRuntimeRegistry,
  request: FdqlProviderAggregateRequest,
  controls: FdqlProviderReadControls,
): Promise<FdqlProviderAggregateResult> {
  const provider = runtime.providers[request.source.provider];
  if (!provider?.aggregate) {
    throw new Error(`No aggregate runtime registered for provider ${request.source.provider}.`);
  }
  try {
    return await provider.aggregate(request, controls);
  } catch (error) {
    throw errorWithDiagnosticContext(error, request);
  }
}

export async function* readProvider(
  runtime: FdqlProviderRuntimeRegistry,
  request: FdqlProviderReadRequest,
  controls: FdqlProviderReadControls,
): AsyncIterable<FdqlProviderRow> {
  const provider = runtime.providers[request.source.provider];
  if (!provider) {
    throw new Error(`No runtime registered for provider ${request.source.provider}.`);
  }
  try {
    yield* provider.read(request, controls);
  } catch (error) {
    throw errorWithDiagnosticContext(error, request);
  }
}

export function providerDialects(
  runtime: FdqlProviderRuntimeRegistry,
): FdqlProviderDialectRegistry {
  return runtime.dialects ?? {};
}

export function contextFor(
  plan: FdqlSingleReadPlan,
  row: RowRecord,
  runtime: FdqlProviderRuntimeRegistry,
): EvalContext {
  return {
    aliases: plan.aliases,
    providers: providerDialects(runtime),
    rows: row as EvalRows,
  };
}
