import type { FdqlState } from './fdqlState.ts';

export interface FdqlTabModel {
  readonly compileResult: FdqlState['compileResults'][string] | undefined;
  readonly isRunning: boolean;
  readonly result: FdqlState['results'][string] | undefined;
  readonly runId: string | null;
  readonly source: string;
  readonly startedAt: number | null;
}

export function selectFdqlTabModel(
  state: FdqlState,
  tab: { readonly id: string; readonly kind: string; } | undefined,
  defaultSource: string,
): FdqlTabModel {
  if (!tab || tab.kind !== 'fdql') {
    return {
      compileResult: undefined,
      isRunning: false,
      result: undefined,
      runId: null,
      source: defaultSource,
      startedAt: null,
    };
  }
  const run = state.activeRuns[tab.id];
  return {
    compileResult: state.compileResults[tab.id],
    isRunning: Boolean(run),
    result: state.results[tab.id],
    runId: run?.runId ?? state.runIds[tab.id] ?? null,
    source: state.sources[tab.id] ?? defaultSource,
    startedAt: run?.startedAt ?? null,
  };
}

export function selectIsFdqlTabRunning(state: FdqlState, tabId: string): boolean {
  return Boolean(state.activeRuns[tabId]);
}
