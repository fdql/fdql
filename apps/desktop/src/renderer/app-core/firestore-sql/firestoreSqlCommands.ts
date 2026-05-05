import type {
  FirestoreSqlCompileRequest,
  FirestoreSqlCompileResult,
  FirestoreSqlContext,
  FirestoreSqlRunEvent,
  FirestoreSqlRunRequest,
  FirestoreSqlRunResult,
} from '@firebase-desk/repo-contracts';
import type { AppCoreStore } from '../shared/store.ts';
import type { FirestoreSqlState } from './firestoreSqlState.ts';
import {
  firestoreSqlCompiled,
  firestoreSqlCompileFailed,
  firestoreSqlContextChanged,
  firestoreSqlEventReceived,
  firestoreSqlRunCancelled,
  firestoreSqlRunFailed,
  firestoreSqlRunFinished,
  firestoreSqlRunStarted,
  firestoreSqlSourceChanged,
  firestoreSqlTabCleared,
} from './firestoreSqlTransitions.ts';

export interface FirestoreSqlCommandEnvironment {
  readonly cancel: (runId: string) => Promise<void>;
  readonly compile: (request: FirestoreSqlCompileRequest) => Promise<FirestoreSqlCompileResult>;
  readonly now: () => number;
  readonly randomToken: () => string;
  readonly recordInteraction: (input: {
    readonly activeTabId: string;
    readonly path: string;
    readonly selectedTreeItemId: string | null;
  }) => void;
  readonly run: (request: FirestoreSqlRunRequest) => Promise<FirestoreSqlRunResult>;
}

export interface FirestoreSqlTabContext {
  readonly connectionId: string;
  readonly id: string;
  readonly kind: string;
}

export function setFirestoreSqlSourceCommand(
  state: FirestoreSqlState,
  input: { readonly source: string; readonly tab: FirestoreSqlTabContext | undefined; },
): FirestoreSqlState {
  if (!input.tab) return state;
  return firestoreSqlSourceChanged(state, input.tab.id, input.source);
}

export function setFirestoreSqlContextCommand(
  state: FirestoreSqlState,
  input: {
    readonly context: FirestoreSqlContext;
    readonly tab: FirestoreSqlTabContext | undefined;
  },
): FirestoreSqlState {
  if (!input.tab) return state;
  return firestoreSqlContextChanged(state, input.tab.id, input.context);
}

export function compileFirestoreSqlCommand(
  store: AppCoreStore<FirestoreSqlState>,
  env: FirestoreSqlCommandEnvironment,
  input: {
    readonly source: string;
    readonly tab: FirestoreSqlTabContext | undefined;
    readonly context: FirestoreSqlContext;
  },
): boolean {
  if (!input.tab || input.tab.kind !== 'firestore-sql') return false;
  env.compile({
    connectionId: input.tab.connectionId,
    context: input.context,
    source: input.source,
  })
    .then((result) => {
      store.update((state) => firestoreSqlCompiled(state, input.tab!.id, result));
    })
    .catch((error: unknown) => {
      store.update((state) => firestoreSqlCompileFailed(state, input.tab!.id, error));
    });
  return true;
}

export function runFirestoreSqlCommand(
  store: AppCoreStore<FirestoreSqlState>,
  env: FirestoreSqlCommandEnvironment,
  input: {
    readonly interactionPath: string;
    readonly selectedTreeItemId: string | null;
    readonly source: string;
    readonly tab: FirestoreSqlTabContext | undefined;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
    readonly context: FirestoreSqlContext;
  },
): boolean {
  if (!input.tab || input.tab.kind !== 'firestore-sql') return false;
  const tab = input.tab;
  const startedAt = env.now();
  const runId = `${tab.id}-${startedAt.toString(36)}-${env.randomToken()}`;
  store.update((state) =>
    firestoreSqlRunStarted(state, {
      connectionId: tab.connectionId,
      runId,
      source: input.source,
      startedAt,
      tabId: tab.id,
    })
  );
  env.run({ connectionId: tab.connectionId, context: input.context, runId, source: input.source })
    .then((result) => {
      const run = store.get().activeRuns[tab.id];
      if (
        !run
        || run.runId !== runId
        || !input.tabIsCurrent(tab.id, tab.connectionId)
      ) return;
      store.update((state) => firestoreSqlRunFinished(state, tab.id, result));
    })
    .catch((error: unknown) => {
      const run = store.get().activeRuns[tab.id];
      if (
        !run
        || run.runId !== runId
        || !input.tabIsCurrent(tab.id, tab.connectionId)
      ) return;
      store.update((state) => firestoreSqlRunFailed(state, tab.id, error));
    });
  env.recordInteraction({
    activeTabId: tab.id,
    path: input.interactionPath,
    selectedTreeItemId: input.selectedTreeItemId,
  });
  return true;
}

export function cancelFirestoreSqlCommand(
  store: AppCoreStore<FirestoreSqlState>,
  env: FirestoreSqlCommandEnvironment,
  input: { readonly tab: FirestoreSqlTabContext | undefined; },
): boolean {
  if (!input.tab) return false;
  const run = store.get().activeRuns[input.tab.id];
  if (!run) return false;
  store.update((state) => firestoreSqlRunCancelled(state, input.tab!.id, env.now()));
  void env.cancel(run.runId).catch(() => undefined);
  return true;
}

export function receiveFirestoreSqlEventCommand(
  store: AppCoreStore<FirestoreSqlState>,
  env: Pick<FirestoreSqlCommandEnvironment, 'now'>,
  input: {
    readonly event: FirestoreSqlRunEvent;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): void {
  store.update((state) =>
    firestoreSqlEventReceived(state, {
      event: input.event,
      now: env.now(),
      tabIsCurrent: input.tabIsCurrent,
    })
  );
}

export function clearFirestoreSqlTabCommand(
  store: AppCoreStore<FirestoreSqlState>,
  env: Pick<FirestoreSqlCommandEnvironment, 'cancel'>,
  tabId: string,
): void {
  const run = store.get().activeRuns[tabId];
  if (run) void env.cancel(run.runId).catch(() => undefined);
  store.update((state) => firestoreSqlTabCleared(state, tabId));
}
