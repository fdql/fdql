import type {
  ActivityLogAppendInput,
  ActivityLogStatus,
  ScriptRunEvent,
  ScriptRunRequest,
  ScriptRunResult,
} from '@firebase-desk/repo-contracts';
import { type AppCoreCommandOptions, commandActivityMetadata } from '../shared/commandOptions.ts';
import type { AppCoreStore } from '../shared/store.ts';
import { scriptResultCounts } from './jsQuerySelectors.ts';
import type { JsQueryState } from './jsQueryState.ts';
import {
  jsQueryCancelFailed,
  jsQueryEventReceived,
  jsQueryRunActivityRecorded,
  jsQueryRunCancelled,
  jsQueryRunFailed,
  jsQueryRunStarted,
  jsQueryRunSucceeded,
  jsQuerySourceChanged,
  jsQueryTabCleared,
  jsQueryTabDuplicated,
  jsQueryTabRuntimeCleared,
  tabForRun,
} from './jsQueryTransitions.ts';

export interface JsQueryCommandEnvironment {
  readonly cancelScript: (runId: string) => Promise<void>;
  readonly now: () => number;
  readonly randomToken: () => string;
  readonly recordActivity: (input: ActivityLogAppendInput) => Promise<void> | void;
  readonly recordInteraction: (input: {
    readonly activeTabId: string;
    readonly path: string;
    readonly selectedTreeItemId: string | null;
  }) => void;
  readonly runScript: (request: ScriptRunRequest) => Promise<ScriptRunResult>;
}

export interface JsQueryTabContext {
  readonly connectionId: string;
  readonly id: string;
  readonly kind: string;
}

export function setJsQuerySourceCommand(
  state: JsQueryState,
  input: { readonly source: string; readonly tab: JsQueryTabContext | undefined; },
): JsQueryState {
  if (!input.tab) return state;
  return jsQuerySourceChanged(state, input.tab.id, input.source);
}

export function runJsQueryCommand(
  store: AppCoreStore<JsQueryState>,
  env: JsQueryCommandEnvironment,
  input: {
    readonly commandOptions?: AppCoreCommandOptions | undefined;
    readonly interactionPath: string;
    readonly selectedTreeItemId: string | null;
    readonly source: string;
    readonly tab: JsQueryTabContext | undefined;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): boolean {
  if (!input.tab || input.tab.kind !== 'js-query') return false;
  const tab = input.tab;
  const startedAt = env.now();
  const runId = createRunId(tab.id, startedAt, env.randomToken());
  store.update((state) =>
    jsQueryRunStarted(state, {
      connectionId: tab.connectionId,
      commandOptions: input.commandOptions,
      runId,
      source: input.source,
      startedAt,
      tabId: tab.id,
    })
  );
  env.runScript({ connectionId: tab.connectionId, runId, source: input.source })
    .then((result) => {
      applyScriptFinalResult(store, env, {
        result,
        runId,
        tabConnectionId: tab.connectionId,
        tabId: tab.id,
        tabIsCurrent: input.tabIsCurrent,
      });
    })
    .catch((error: unknown) => {
      applyScriptFailure(store, env, {
        error,
        runId,
        tabConnectionId: tab.connectionId,
        tabId: tab.id,
        tabIsCurrent: input.tabIsCurrent,
      });
    });
  env.recordInteraction({
    activeTabId: tab.id,
    path: input.interactionPath,
    selectedTreeItemId: input.selectedTreeItemId,
  });
  return true;
}

export function cancelJsQueryCommand(
  store: AppCoreStore<JsQueryState>,
  env: JsQueryCommandEnvironment,
  input: {
    readonly tab: JsQueryTabContext | undefined;
    readonly tabExists: (tabId: string, connectionId: string) => boolean;
  },
): boolean {
  if (!input.tab) return false;
  const run = store.get().activeRuns[input.tab.id];
  if (!run) return false;
  store.update((state) => jsQueryRunCancelled(state, input.tab!.id, env.now()));
  recordScriptActivityOnce(store, env, input.tab.id, run);
  env.cancelScript(run.runId)
    .catch((error: unknown) => {
      store.update((state) =>
        jsQueryCancelFailed(state, {
          connectionId: run.connectionId,
          error,
          runId: run.runId,
          tabExists: input.tabExists(input.tab!.id, run.connectionId),
          tabId: input.tab!.id,
        })
      );
    });
  return true;
}

export function clearJsQueryTabCommand(
  store: AppCoreStore<JsQueryState>,
  env: Pick<JsQueryCommandEnvironment, 'cancelScript'>,
  tabId: string,
): void {
  const run = store.get().activeRuns[tabId];
  if (run) void env.cancelScript(run.runId).catch(() => undefined);
  store.update((state) => jsQueryTabCleared(state, tabId));
}

export function duplicateJsQueryTabCommand(
  store: AppCoreStore<JsQueryState>,
  sourceTabId: string,
  targetTabId: string,
): void {
  store.update((state) => jsQueryTabDuplicated(state, sourceTabId, targetTabId));
}

export function clearJsQueryTabRuntimeCommand(
  store: AppCoreStore<JsQueryState>,
  env: Pick<JsQueryCommandEnvironment, 'cancelScript'>,
  tabId: string,
): void {
  const run = store.get().activeRuns[tabId];
  if (run) void env.cancelScript(run.runId).catch(() => undefined);
  store.update((state) => jsQueryTabRuntimeCleared(state, tabId));
}

export function receiveJsQueryEventCommand(
  store: AppCoreStore<JsQueryState>,
  env: Pick<JsQueryCommandEnvironment, 'now' | 'recordActivity'>,
  input: {
    readonly event: ScriptRunEvent;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): void {
  const before = store.get();
  const tabEntry = tabForRun(before, input.event.runId);
  store.set(jsQueryEventReceived(before, {
    event: input.event,
    now: env.now(),
    tabIsCurrent: input.tabIsCurrent,
  }));
  if (input.event.type === 'complete' && tabEntry) {
    recordScriptActivityOnce(store, env, tabEntry.tabId, tabEntry.run);
  }
}

function applyScriptFinalResult(
  store: AppCoreStore<JsQueryState>,
  env: Pick<JsQueryCommandEnvironment, 'recordActivity'>,
  input: {
    readonly result: ScriptRunResult;
    readonly runId: string;
    readonly tabConnectionId: string;
    readonly tabId: string;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): void {
  const run = store.get().activeRuns[input.tabId];
  if (
    !run
    || run.runId !== input.runId
    || run.connectionId !== input.tabConnectionId
    || !input.tabIsCurrent(input.tabId, run.connectionId)
  ) {
    return;
  }
  store.update((state) => jsQueryRunSucceeded(state, input.tabId, input.result));
  recordScriptActivityOnce(store, env, input.tabId, run);
}

function applyScriptFailure(
  store: AppCoreStore<JsQueryState>,
  env: Pick<JsQueryCommandEnvironment, 'recordActivity'>,
  input: {
    readonly error: unknown;
    readonly runId: string;
    readonly tabConnectionId: string;
    readonly tabId: string;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): void {
  const run = store.get().activeRuns[input.tabId];
  if (
    !run
    || run.runId !== input.runId
    || run.connectionId !== input.tabConnectionId
    || !input.tabIsCurrent(input.tabId, run.connectionId)
  ) {
    return;
  }
  store.update((state) => jsQueryRunFailed(state, input.tabId, input.error));
  recordScriptActivityOnce(store, env, input.tabId, run);
}

function recordScriptActivityOnce(
  store: AppCoreStore<JsQueryState>,
  env: Pick<JsQueryCommandEnvironment, 'recordActivity'>,
  tabId: string,
  run: {
    readonly commandOptions?: AppCoreCommandOptions | undefined;
    readonly connectionId: string;
    readonly runId: string;
    readonly source: string;
  },
): void {
  const state = store.get();
  if (state.loggedRunIds.includes(run.runId)) return;
  const result = state.results[tabId];
  if (!result) return;
  store.update((current) => jsQueryRunActivityRecorded(current, run.runId));
  void env.recordActivity(
    scriptActivityInput(result, run.connectionId, run.source, run.commandOptions),
  );
}

function scriptActivityInput(
  result: ScriptRunResult,
  connectionId: string,
  source: string,
  commandOptions: AppCoreCommandOptions | undefined,
): ActivityLogAppendInput {
  const status: ActivityLogStatus = result.cancelled
    ? 'cancelled'
    : result.errors.length > 0
    ? 'failure'
    : 'success';
  return {
    action: result.cancelled ? 'Cancel JavaScript query' : 'Run JavaScript query',
    area: 'js-query',
    ...(result.errors[0] ? { error: result.errors[0] } : {}),
    durationMs: result.durationMs,
    metadata: { ...commandActivityMetadata(commandOptions), ...scriptResultCounts(result) },
    payload: { source },
    status,
    summary: result.cancelled
      ? 'JavaScript query cancelled'
      : result.errors.length > 0
      ? `JavaScript query failed with ${result.errors.length} error${
        result.errors.length === 1 ? '' : 's'
      }`
      : 'JavaScript query completed',
    target: { connectionId, type: 'script' },
  };
}

function createRunId(tabId: string, now: number, token: string): string {
  return `${tabId}-${now.toString(36)}-${token}`;
}
