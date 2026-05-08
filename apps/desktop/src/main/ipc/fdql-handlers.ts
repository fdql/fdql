import type { IpcResponse } from '@firebase-desk/ipc-schemas';
import type { FdqlRepository, FdqlResultRowLineage } from '@firebase-desk/repo-contracts';
import type { IpcHandlerMap } from './handler-types.ts';

export function createFdqlHandlers(
  repository: Pick<FdqlRepository, 'cancel' | 'compile' | 'run'>,
): Pick<IpcHandlerMap, 'fdql.cancel' | 'fdql.compile' | 'fdql.run'> {
  return {
    'fdql.cancel': async ({ runId }) => {
      await repository.cancel(runId);
    },
    'fdql.compile': async (request) => toIpcCompileResult(await repository.compile(request)),
    'fdql.run': async (request) => toIpcRunResult(await repository.run(request)),
  };
}

function toIpcCompileResult(
  result: Awaited<ReturnType<FdqlRepository['compile']>>,
): IpcResponse<'fdql.compile'> {
  return {
    diagnostics: [...result.diagnostics],
    ok: result.ok,
  };
}

function toIpcRunResult(
  result: Awaited<ReturnType<FdqlRepository['run']>>,
): IpcResponse<'fdql.run'> {
  return {
    ...(result.cancelled === undefined ? {} : { cancelled: result.cancelled }),
    ...(result.command === undefined ? {} : { command: result.command }),
    diagnostics: [...result.diagnostics],
    durationMs: result.durationMs,
    ...(result.rowLineages === undefined
      ? {}
      : { rowLineages: result.rowLineages.map(toIpcRowLineage) }),
    rows: [...result.rows],
    stats: result.stats
      ? { ...result.stats, stageStats: [...result.stats.stageStats] }
      : null,
  };
}

function toIpcRowLineage(
  lineage: FdqlResultRowLineage,
): NonNullable<IpcResponse<'fdql.run'>['rowLineages']>[number] {
  return {
    bindings: lineage.bindings.map((binding) => ({
      binding: binding.binding,
      sources: binding.sources.map((source) => ({ ...source })),
    })),
    mode: lineage.mode,
    readContribution: lineage.readContribution,
    sources: lineage.sources.map((source) => ({ ...source })),
    ...(lineage.trace ? { trace: lineage.trace.map((step) => ({ ...step })) } : {}),
  };
}
