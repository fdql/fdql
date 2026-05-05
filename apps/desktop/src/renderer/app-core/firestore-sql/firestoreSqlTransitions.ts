import type {
  FirestoreSqlCompileResult,
  FirestoreSqlContext,
  FirestoreSqlDiagnostic,
  FirestoreSqlRunEvent,
  FirestoreSqlRunResult,
} from '@firebase-desk/repo-contracts';
import type { ActiveFirestoreSqlRun, FirestoreSqlState } from './firestoreSqlState.ts';

export function firestoreSqlSourceChanged(
  state: FirestoreSqlState,
  tabId: string,
  source: string,
): FirestoreSqlState {
  return { ...state, sources: { ...state.sources, [tabId]: source } };
}

export function firestoreSqlContextChanged(
  state: FirestoreSqlState,
  tabId: string,
  context: FirestoreSqlContext,
): FirestoreSqlState {
  return { ...state, contexts: { ...state.contexts, [tabId]: context } };
}

export function firestoreSqlCompiled(
  state: FirestoreSqlState,
  tabId: string,
  result: FirestoreSqlCompileResult,
): FirestoreSqlState {
  return { ...state, compileResults: { ...state.compileResults, [tabId]: result } };
}

export function firestoreSqlCompileFailed(
  state: FirestoreSqlState,
  tabId: string,
  error: unknown,
): FirestoreSqlState {
  return firestoreSqlCompiled(state, tabId, {
    diagnostics: [diagnosticFromUnknown(error)],
    ok: false,
  });
}

export function firestoreSqlRunStarted(
  state: FirestoreSqlState,
  input: {
    readonly connectionId: string;
    readonly runId: string;
    readonly source: string;
    readonly startedAt: number;
    readonly tabId: string;
  },
): FirestoreSqlState {
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

export function firestoreSqlRunFinished(
  state: FirestoreSqlState,
  tabId: string,
  result: FirestoreSqlRunResult,
): FirestoreSqlState {
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    results: { ...state.results, [tabId]: result },
  };
}

export function firestoreSqlRunFailed(
  state: FirestoreSqlState,
  tabId: string,
  error: unknown,
): FirestoreSqlState {
  return firestoreSqlRunFinished(state, tabId, {
    diagnostics: [diagnosticFromUnknown(error)],
    durationMs: 0,
    rows: state.results[tabId]?.rows ?? [],
    stats: state.results[tabId]?.stats ?? null,
  });
}

export function firestoreSqlRunCancelled(
  state: FirestoreSqlState,
  tabId: string,
  now: number,
): FirestoreSqlState {
  const run = state.activeRuns[tabId];
  if (!run) return state;
  return firestoreSqlRunFinished(state, tabId, {
    cancelled: true,
    diagnostics: state.results[tabId]?.diagnostics ?? [],
    durationMs: Math.max(0, now - run.startedAt),
    rows: state.results[tabId]?.rows ?? [],
    stats: state.results[tabId]?.stats ?? null,
  });
}

export function firestoreSqlEventReceived(
  state: FirestoreSqlState,
  input: {
    readonly event: FirestoreSqlRunEvent;
    readonly now: number;
    readonly tabIsCurrent: (tabId: string, connectionId: string) => boolean;
  },
): FirestoreSqlState {
  const tabEntry = tabForRun(state, input.event.runId);
  if (!tabEntry) return state;
  if (!input.tabIsCurrent(tabEntry.tabId, tabEntry.run.connectionId)) return state;
  const current = state.results[tabEntry.tabId]
    ?? emptyRunningResult(tabEntry.run.startedAt, input.now);

  if (input.event.type === 'plan') {
    return firestoreSqlCompiled(state, tabEntry.tabId, {
      diagnostics: state.compileResults[tabEntry.tabId]?.diagnostics ?? [],
      ok: true,
      plan: input.event.plan,
      ...(state.compileResults[tabEntry.tabId]?.snippet === undefined
        ? {}
        : { snippet: state.compileResults[tabEntry.tabId]?.snippet }),
    });
  }
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
  if (input.event.type === 'completed' || input.event.type === 'cancelled') {
    return firestoreSqlRunFinished(state, tabEntry.tabId, input.event.result);
  }
  if (input.event.type === 'failed') {
    return firestoreSqlRunFinished(state, tabEntry.tabId, input.event.result);
  }
  return state;
}

export function firestoreSqlTabCleared(state: FirestoreSqlState, tabId: string): FirestoreSqlState {
  return {
    ...state,
    activeRuns: omitKey(state.activeRuns, tabId),
    compileResults: omitKey(state.compileResults, tabId),
    contexts: omitKey(state.contexts, tabId),
    results: omitKey(state.results, tabId),
    runIds: omitKey(state.runIds, tabId),
    sources: omitKey(state.sources, tabId),
  };
}

export function tabForRun(
  state: FirestoreSqlState,
  runId: string,
): { readonly run: ActiveFirestoreSqlRun; readonly tabId: string; } | null {
  for (const [tabId, run] of Object.entries(state.activeRuns)) {
    if (run.runId === runId) return { run, tabId };
  }
  return null;
}

function emptyRunningResult(startedAt: number, now: number): FirestoreSqlRunResult {
  return {
    diagnostics: [],
    durationMs: Math.max(0, now - startedAt),
    rows: [],
    stats: null,
  };
}

function diagnosticFromUnknown(error: unknown): FirestoreSqlDiagnostic {
  return {
    code: 'FIRESTORE_SQL_ERROR',
    message: error instanceof Error ? error.message : 'Firestore SQL failed.',
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
