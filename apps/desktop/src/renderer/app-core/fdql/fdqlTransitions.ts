import type {
  FdqlCompileResult,
  FdqlDiagnostic,
  FdqlRunEvent,
  FdqlRunResult,
} from '@firebase-desk/repo-contracts';
import type { ActiveFdqlRun, FdqlState } from './fdqlState.ts';

export function fdqlSourceChanged(state: FdqlState, tabId: string, source: string): FdqlState {
  return { ...state, sources: { ...state.sources, [tabId]: source } };
}

export function fdqlCompiled(
  state: FdqlState,
  tabId: string,
  result: FdqlCompileResult,
): FdqlState {
  return { ...state, compileResults: { ...state.compileResults, [tabId]: result } };
}

export function fdqlCompileFailed(state: FdqlState, tabId: string, error: unknown): FdqlState {
  return fdqlCompiled(state, tabId, {
    diagnostics: [diagnosticFromUnknown(error)],
    ok: false,
  });
}

export function fdqlRunRequested(state: FdqlState, tabId: string): FdqlState {
  return {
    ...state,
    compileResults: omitKey(state.compileResults, tabId),
    results: omitKey(state.results, tabId),
  };
}

export function fdqlRunStarted(
  state: FdqlState,
  input: {
    readonly connectionId: string;
    readonly runId: string;
    readonly source: string;
    readonly startedAt: number;
    readonly tabId: string;
  },
): FdqlState {
  return {
    ...state,
    activeRuns: {
      ...state.activeRuns,
      [input.tabId]: {
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

export function fdqlRunFinished(
  state: FdqlState,
  tabId: string,
  result: FdqlRunResult,
): FdqlState {
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    results: { ...state.results, [tabId]: result },
  };
}

export function fdqlRunFailed(state: FdqlState, tabId: string, error: unknown): FdqlState {
  return fdqlRunFinished(state, tabId, {
    diagnostics: [diagnosticFromUnknown(error)],
    durationMs: 0,
    rows: state.results[tabId]?.rows ?? [],
    stats: state.results[tabId]?.stats ?? null,
  });
}

export function fdqlRunCancelled(state: FdqlState, tabId: string, now: number): FdqlState {
  const run = state.activeRuns[tabId];
  if (!run) return state;
  return fdqlRunFinished(state, tabId, {
    cancelled: true,
    diagnostics: state.results[tabId]?.diagnostics ?? [],
    durationMs: Math.max(0, now - run.startedAt),
    rows: state.results[tabId]?.rows ?? [],
    stats: state.results[tabId]?.stats ?? null,
  });
}

export function fdqlEventReceived(
  state: FdqlState,
  input: {
    readonly event: FdqlRunEvent;
    readonly now: number;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): FdqlState {
  const tabEntry = tabForRun(state, input.event.runId);
  if (!tabEntry) return state;
  if (!input.tabIsCurrent(tabEntry.tabId, tabEntry.run.connectionId)) return state;
  const current = state.results[tabEntry.tabId]
    ?? emptyRunningResult(tabEntry.run.startedAt, input.now);

  if (input.event.type === 'diagnostic') {
    return {
      ...state,
      results: {
        ...state.results,
        [tabEntry.tabId]: {
          ...current,
          diagnostics: [...current.diagnostics, input.event.diagnostic],
          durationMs: Math.max(0, input.now - tabEntry.run.startedAt),
        },
      },
    };
  }
  if (input.event.type === 'row') {
    return {
      ...state,
      results: {
        ...state.results,
        [tabEntry.tabId]: {
          ...current,
          durationMs: Math.max(0, input.now - tabEntry.run.startedAt),
          rows: [...current.rows, input.event.row],
        },
      },
    };
  }
  if (input.event.type === 'stats') {
    return {
      ...state,
      results: {
        ...state.results,
        [tabEntry.tabId]: {
          ...current,
          durationMs: Math.max(0, input.now - tabEntry.run.startedAt),
          stats: input.event.stats,
        },
      },
    };
  }
  if (
    input.event.type === 'completed'
    || input.event.type === 'cancelled'
    || input.event.type === 'failed'
  ) {
    return fdqlRunFinished(state, tabEntry.tabId, input.event.result);
  }
  return state;
}

export function fdqlTabCleared(state: FdqlState, tabId: string): FdqlState {
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    compileResults: omitKey(state.compileResults, tabId),
    results: omitKey(state.results, tabId),
    runIds: omitKey(state.runIds, tabId),
    sources: omitKey(state.sources, tabId),
  };
}

export function tabForRun(
  state: FdqlState,
  runId: string,
): { readonly run: ActiveFdqlRun; readonly tabId: string; } | null {
  for (const [tabId, run] of Object.entries(state.activeRuns)) {
    if (run.runId === runId) return { run, tabId };
  }
  return null;
}

function emptyRunningResult(startedAt: number, now: number): FdqlRunResult {
  return {
    diagnostics: [],
    durationMs: Math.max(0, now - startedAt),
    rows: [],
    stats: null,
  };
}

function diagnosticFromUnknown(error: unknown): FdqlDiagnostic {
  return {
    code: 'FDQL_ERROR',
    message: error instanceof Error ? error.message : 'FDQL failed.',
    severity: 'error',
  };
}

function omitKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  const { [key]: _omitted, ...next } = record;
  return next;
}
