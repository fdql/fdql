import type {
  FdqlCompileRequest,
  FdqlCompileResult,
  FdqlRunEvent,
  FdqlRunRequest,
  FdqlRunResult,
} from '@firebase-desk/repo-contracts';
import type { AppCoreStore } from '../shared/store.ts';
import type { FdqlState } from './fdqlState.ts';
import {
  fdqlCompiled,
  fdqlCompileFailed,
  fdqlEventReceived,
  fdqlRunCancelled,
  fdqlRunFailed,
  fdqlRunFinished,
  fdqlRunRequested,
  fdqlRunStarted,
  fdqlSourceChanged,
  fdqlTabCleared,
  fdqlTabDuplicated,
  fdqlTabRuntimeCleared,
} from './fdqlTransitions.ts';

export interface FdqlCommandEnvironment {
  readonly cancel: (runId: string) => Promise<void>;
  readonly compile: (request: FdqlCompileRequest) => Promise<FdqlCompileResult>;
  readonly now: () => number;
  readonly randomToken: () => string;
  readonly recordInteraction: (input: {
    readonly activeTabId: string;
    readonly path: string;
    readonly selectedTreeItemId: string | null;
  }) => void;
  readonly run: (request: FdqlRunRequest) => Promise<FdqlRunResult>;
}

export interface FdqlTabContext {
  readonly connectionId: string;
  readonly id: string;
  readonly kind: string;
}

export function setFdqlSourceCommand(
  state: FdqlState,
  input: { readonly source: string; readonly tab: FdqlTabContext | undefined; },
): FdqlState {
  if (!input.tab) return state;
  return fdqlSourceChanged(state, input.tab.id, input.source);
}

export function runFdqlCommand(
  store: AppCoreStore<FdqlState>,
  env: FdqlCommandEnvironment,
  input: {
    readonly interactionPath: string;
    readonly selectedTreeItemId: string | null;
    readonly source: string;
    readonly tab: FdqlTabContext | undefined;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): boolean {
  if (!input.tab || input.tab.kind !== 'fdql') return false;
  const tab = input.tab;

  store.update((state) => fdqlRunRequested(state, tab.id));
  env.compile({ connectionId: tab.connectionId, source: input.source })
    .then((compiled) => {
      store.update((state) => fdqlCompiled(state, tab.id, compiled));
      if (!compiled.ok) return;
      const startedAt = env.now();
      const runId = `${tab.id}-${startedAt.toString(36)}-${env.randomToken()}`;
      store.update((state) =>
        fdqlRunStarted(state, {
          connectionId: tab.connectionId,
          runId,
          source: input.source,
          startedAt,
          tabId: tab.id,
        })
      );
      env.run({ connectionId: tab.connectionId, runId, source: input.source })
        .then((result) => {
          const run = store.get().activeRuns[tab.id];
          if (!run || run.runId !== runId || !input.tabIsCurrent(tab.id, tab.connectionId)) return;
          store.update((state) => fdqlRunFinished(state, tab.id, result));
        })
        .catch((error: unknown) => {
          const run = store.get().activeRuns[tab.id];
          if (!run || run.runId !== runId || !input.tabIsCurrent(tab.id, tab.connectionId)) return;
          store.update((state) => fdqlRunFailed(state, tab.id, error));
        });
      env.recordInteraction({
        activeTabId: tab.id,
        path: input.interactionPath,
        selectedTreeItemId: input.selectedTreeItemId,
      });
    })
    .catch((error: unknown) => {
      store.update((state) => fdqlCompileFailed(state, tab.id, error));
    });
  return true;
}

export function cancelFdqlCommand(
  store: AppCoreStore<FdqlState>,
  env: FdqlCommandEnvironment,
  input: { readonly tab: FdqlTabContext | undefined; },
): boolean {
  if (!input.tab) return false;
  const run = store.get().activeRuns[input.tab.id];
  if (!run) return false;
  store.update((state) => fdqlRunCancelled(state, input.tab!.id, env.now()));
  void env.cancel(run.runId).catch(() => undefined);
  return true;
}

export function receiveFdqlEventCommand(
  store: AppCoreStore<FdqlState>,
  env: Pick<FdqlCommandEnvironment, 'now'>,
  input: {
    readonly event: FdqlRunEvent;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): void {
  store.update((state) =>
    fdqlEventReceived(state, {
      event: input.event,
      now: env.now(),
      tabIsCurrent: input.tabIsCurrent,
    })
  );
}

export function clearFdqlTabCommand(
  store: AppCoreStore<FdqlState>,
  env: Pick<FdqlCommandEnvironment, 'cancel'>,
  tabId: string,
): void {
  const run = store.get().activeRuns[tabId];
  if (run) void env.cancel(run.runId).catch(() => undefined);
  store.update((state) => fdqlTabCleared(state, tabId));
}

export function duplicateFdqlTabCommand(
  store: AppCoreStore<FdqlState>,
  sourceTabId: string,
  targetTabId: string,
): void {
  store.update((state) => fdqlTabDuplicated(state, sourceTabId, targetTabId));
}

export function clearFdqlTabRuntimeCommand(
  store: AppCoreStore<FdqlState>,
  env: Pick<FdqlCommandEnvironment, 'cancel'>,
  tabId: string,
): void {
  const run = store.get().activeRuns[tabId];
  if (run) void env.cancel(run.runId).catch(() => undefined);
  store.update((state) => fdqlTabRuntimeCleared(state, tabId));
}
