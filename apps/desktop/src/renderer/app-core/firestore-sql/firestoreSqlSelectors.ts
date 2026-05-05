import type { FirestoreSqlState } from './firestoreSqlState.ts';

export interface FirestoreSqlTabModel {
  readonly compileResult: FirestoreSqlState['compileResults'][string] | undefined;
  readonly context: FirestoreSqlState['contexts'][string];
  readonly isRunning: boolean;
  readonly result: FirestoreSqlState['results'][string] | undefined;
  readonly runId: string | null;
  readonly source: string;
  readonly startedAt: number | null;
}

export function selectFirestoreSqlTabModel(
  state: FirestoreSqlState,
  tab: { readonly id: string; readonly kind: string; } | undefined,
  defaultSource: string,
): FirestoreSqlTabModel {
  if (!tab || tab.kind !== 'firestore-sql') {
    return {
      compileResult: undefined,
      context: {},
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
    context: state.contexts[tab.id] ?? {},
    isRunning: Boolean(run),
    result: state.results[tab.id],
    runId: run?.runId ?? state.runIds[tab.id] ?? null,
    source: state.sources[tab.id] ?? defaultSource,
    startedAt: run?.startedAt ?? null,
  };
}

export function selectIsFirestoreSqlTabRunning(
  state: FirestoreSqlState,
  tabId: string,
): boolean {
  return Boolean(state.activeRuns[tabId]);
}
