import type {
  ScriptRunError,
  ScriptRunEvent,
  ScriptRunResult,
} from '@firebase-desk/repo-contracts';
import type { AppCoreCommandOptions } from '../shared/commandOptions.ts';
import type { ActiveScriptRun, JsQueryState } from './jsQueryState.ts';

const MAX_LOGGED_RUN_IDS = 500;

export function jsQuerySourceChanged(
  state: JsQueryState,
  tabId: string,
  source: string,
): JsQueryState {
  return { ...state, scripts: { ...state.scripts, [tabId]: source } };
}

export function jsQueryTabDuplicated(
  state: JsQueryState,
  sourceTabId: string,
  targetTabId: string,
): JsQueryState {
  const source = state.scripts[sourceTabId];
  return source === undefined ? state : jsQuerySourceChanged(state, targetTabId, source);
}

export function jsQueryRunStarted(
  state: JsQueryState,
  input: {
    readonly commandOptions?: AppCoreCommandOptions | undefined;
    readonly connectionId: string;
    readonly runId: string;
    readonly source: string;
    readonly startedAt: number;
    readonly tabId: string;
  },
): JsQueryState {
  return {
    ...state,
    activeRuns: {
      ...state.activeRuns,
      [input.tabId]: {
        commandOptions: input.commandOptions,
        connectionId: input.connectionId,
        runId: input.runId,
        source: input.source,
        startedAt: input.startedAt,
      },
    },
    results: omitKey(state.results, input.tabId),
    runIds: { ...state.runIds, [input.tabId]: input.runId },
  };
}

export function jsQueryRunSucceeded(
  state: JsQueryState,
  tabId: string,
  result: ScriptRunResult,
): JsQueryState {
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    results: { ...state.results, [tabId]: result },
  };
}

export function jsQueryRunFailed(
  state: JsQueryState,
  tabId: string,
  error: unknown,
): JsQueryState {
  return jsQueryRunSucceeded(state, tabId, scriptErrorResult(error, state.results[tabId]));
}

export function jsQueryRunCancelled(
  state: JsQueryState,
  tabId: string,
  now: number,
): JsQueryState {
  const run = state.activeRuns[tabId];
  if (!run) return state;
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    results: {
      ...state.results,
      [tabId]: scriptCancelledResult(run.startedAt, now, state.results[tabId]),
    },
  };
}

export function jsQueryCancelFailed(
  state: JsQueryState,
  input: {
    readonly connectionId: string;
    readonly error: unknown;
    readonly runId: string;
    readonly tabExists: boolean;
    readonly tabId: string;
  },
): JsQueryState {
  if (!input.tabExists) return state;
  const latestRun = state.activeRuns[input.tabId];
  const currentResult = state.results[input.tabId];
  if (currentResult?.cancelled !== true) return state;
  if (latestRun && latestRun.runId !== input.runId) return state;
  return {
    ...state,
    results: {
      ...state.results,
      [input.tabId]: scriptErrorResult(input.error, currentResult),
    },
  };
}

export function jsQueryEventReceived(
  state: JsQueryState,
  input: {
    readonly event: ScriptRunEvent;
    readonly now: number;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): JsQueryState {
  const tabEntry = tabForRun(state, input.event.runId);
  if (!tabEntry) return state;
  const { run, tabId } = tabEntry;
  if (!input.tabIsCurrent(tabId, run.connectionId)) return state;

  if (input.event.type === 'complete') return jsQueryRunSucceeded(state, tabId, input.event.result);

  return {
    ...state,
    results: {
      ...state.results,
      [tabId]: resultWithEvent(state.results[tabId], input.event, run.startedAt, input.now),
    },
  };
}

export function jsQueryTabCleared(state: JsQueryState, tabId: string): JsQueryState {
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    results: omitKey(state.results, tabId),
    runIds: omitKey(state.runIds, tabId),
    scripts: omitKey(state.scripts, tabId),
  };
}

export function jsQueryTabRuntimeCleared(state: JsQueryState, tabId: string): JsQueryState {
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    results: omitKey(state.results, tabId),
    runIds: omitKey(state.runIds, tabId),
  };
}

export function jsQueryRunActivityRecorded(state: JsQueryState, runId: string): JsQueryState {
  if (state.loggedRunIds.includes(runId)) return state;
  return {
    ...state,
    loggedRunIds: [...state.loggedRunIds, runId].slice(-MAX_LOGGED_RUN_IDS),
  };
}

export function scriptErrorResult(error: unknown, current?: ScriptRunResult): ScriptRunResult {
  return {
    returnValue: null,
    stream: current?.stream ?? [],
    logs: current?.logs ?? [],
    errors: [
      ...(current?.errors ?? []),
      scriptErrorFromUnknown(error),
    ],
    durationMs: current?.durationMs ?? 0,
  };
}

export function scriptCancelledResult(
  startedAt: number,
  now: number,
  current?: ScriptRunResult,
): ScriptRunResult {
  return {
    returnValue: null,
    stream: current?.stream ?? [],
    logs: [
      ...(current?.logs ?? []),
      { level: 'info', message: 'Script cancelled', timestamp: new Date(now).toISOString() },
    ],
    errors: current?.errors ?? [],
    durationMs: Math.max(0, now - startedAt),
    cancelled: true,
  };
}

export function resultWithEvent(
  current: ScriptRunResult | undefined,
  event: Exclude<ScriptRunEvent, { readonly type: 'complete'; }>,
  startedAt: number,
  now: number,
): ScriptRunResult {
  const base = current ?? emptyRunningResult(startedAt, now);
  const durationMs = Math.max(0, now - startedAt);
  if (event.type === 'output') {
    return { ...base, stream: [...(base.stream ?? []), event.item], durationMs };
  }
  if (event.type === 'log') {
    return { ...base, logs: [...base.logs, event.log], durationMs };
  }
  return { ...base, errors: [...base.errors, event.error], durationMs };
}

export function emptyRunningResult(startedAt: number, now: number): ScriptRunResult {
  return {
    returnValue: null,
    stream: [],
    logs: [],
    errors: [],
    durationMs: Math.max(0, now - startedAt),
  };
}

export function tabForRun(
  state: JsQueryState,
  runId: string,
): { readonly run: ActiveScriptRun; readonly tabId: string; } | null {
  for (const [tabId, run] of Object.entries(state.activeRuns)) {
    if (run.runId === runId) return { run, tabId };
  }
  return null;
}

function scriptErrorFromUnknown(error: unknown): ScriptRunError {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : 'Could not run JavaScript query.',
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  };
}

function omitKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  const { [key]: _omitted, ...next } = record;
  return next;
}
