import type { IpcResponse } from '@firebase-desk/ipc-schemas';
import type { FirestoreSqlRepository } from '@firebase-desk/repo-contracts';
import type { IpcHandlerMap } from './handler-types.ts';

export function createFirestoreSqlHandlers(
  repository: Pick<FirestoreSqlRepository, 'cancel' | 'compile' | 'run'>,
): Pick<
  IpcHandlerMap,
  'firestoreSql.cancel' | 'firestoreSql.compile' | 'firestoreSql.run'
> {
  return {
    'firestoreSql.cancel': async ({ runId }) => {
      await repository.cancel(runId);
    },
    'firestoreSql.compile': async (request) =>
      toIpcCompileResult(await repository.compile(request)),
    'firestoreSql.run': async (request) => {
      const result = await repository.run(request);
      return toIpcRunResult(result);
    },
  };
}

function toIpcCompileResult(
  result: Awaited<ReturnType<FirestoreSqlRepository['compile']>>,
): IpcResponse<'firestoreSql.compile'> {
  return {
    diagnostics: [...result.diagnostics],
    ok: result.ok,
    ...(result.plan === undefined ? {} : { plan: result.plan }),
    ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
  };
}

function toIpcRunResult(
  result: Awaited<ReturnType<FirestoreSqlRepository['run']>>,
): IpcResponse<'firestoreSql.run'> {
  return {
    ...(result.cancelled === undefined ? {} : { cancelled: result.cancelled }),
    diagnostics: [...result.diagnostics],
    durationMs: result.durationMs,
    rows: [...result.rows],
    stats: result.stats,
  };
}
