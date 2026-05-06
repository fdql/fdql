import type { IpcResponse } from '@firebase-desk/ipc-schemas';
import type { FdqlRepository } from '@firebase-desk/repo-contracts';
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
    diagnostics: [...result.diagnostics],
    durationMs: result.durationMs,
    rows: [...result.rows],
    stats: result.stats,
  };
}
