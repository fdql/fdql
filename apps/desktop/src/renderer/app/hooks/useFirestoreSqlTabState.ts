import { FIRESTORE_SQL_SAMPLE_SOURCE } from '@firebase-desk/product-ui';
import type {
  FirestoreSqlCompileResult,
  FirestoreSqlContext,
  FirestoreSqlRunEvent,
  FirestoreSqlRunResult,
} from '@firebase-desk/repo-contracts';
import { useEffect, useMemo, useRef } from 'react';
import {
  cancelFirestoreSqlCommand,
  clearFirestoreSqlTabCommand,
  compileFirestoreSqlCommand,
  duplicateFirestoreSqlTabCommand,
  type FirestoreSqlCommandEnvironment,
  receiveFirestoreSqlEventCommand,
  runFirestoreSqlCommand,
  setFirestoreSqlContextCommand,
  setFirestoreSqlSourceCommand,
} from '../../app-core/firestore-sql/firestoreSqlCommands.ts';
import {
  selectFirestoreSqlTabModel,
  selectIsFirestoreSqlTabRunning,
} from '../../app-core/firestore-sql/firestoreSqlSelectors.ts';
import {
  createFirestoreSqlStore,
  type FirestoreSqlStore,
} from '../../app-core/firestore-sql/firestoreSqlStore.ts';
import { useAppCoreSelector } from '../../app-core/shared/reactStore.ts';
import { useRepositories } from '../RepositoryProvider.tsx';
import { activePath, tabActions, tabsStore, type WorkspaceTab } from '../stores/tabsStore.ts';

interface UseFirestoreSqlTabStateInput {
  readonly activeTab: WorkspaceTab | undefined;
  readonly initialContexts?: Readonly<Record<string, FirestoreSqlContext>> | undefined;
  readonly initialSources?: Readonly<Record<string, string>> | undefined;
  readonly selectedTreeItemId: string | null;
  readonly store?: FirestoreSqlStore | undefined;
}

export interface FirestoreSqlTabState {
  readonly compileResult: FirestoreSqlCompileResult | undefined;
  readonly context: FirestoreSqlContext;
  readonly contexts: Readonly<Record<string, FirestoreSqlContext>>;
  readonly isRunning: boolean;
  readonly result: FirestoreSqlRunResult | undefined;
  readonly runId: string | null;
  readonly runStartedAt: number | null;
  readonly source: string;
  readonly sources: Readonly<Record<string, string>>;
  readonly cancel: () => boolean;
  readonly clearTab: (tabId: string) => void;
  readonly compile: () => boolean;
  readonly duplicateTab: (sourceTabId: string, targetTabId: string) => void;
  readonly isTabRunning: (tabId: string) => boolean;
  readonly run: () => boolean;
  readonly setContext: (context: FirestoreSqlContext) => void;
  readonly setSource: (source: string) => void;
}

export function useFirestoreSqlTabState(
  {
    activeTab,
    initialContexts,
    initialSources,
    selectedTreeItemId,
    store: inputStore,
  }: UseFirestoreSqlTabStateInput,
): FirestoreSqlTabState {
  const store = useMemo(
    () =>
      inputStore ?? createFirestoreSqlStore({ contexts: initialContexts, sources: initialSources }),
    [initialContexts, initialSources, inputStore],
  );
  const state = useAppCoreSelector(store, (snapshot) => snapshot);
  const eventHandlerRef = useRef<(event: FirestoreSqlRunEvent) => void>(() => {});
  const repositories = useRepositories();
  const model = selectFirestoreSqlTabModel(state, activeTab, FIRESTORE_SQL_SAMPLE_SOURCE);
  const env: FirestoreSqlCommandEnvironment = {
    cancel: (runId) => repositories.firestoreSql.cancel(runId),
    compile: (request) => repositories.firestoreSql.compile(request),
    now: Date.now,
    randomToken: () => Math.random().toString(36).slice(2, 10),
    recordInteraction: tabActions.recordInteraction,
    run: (request) => repositories.firestoreSql.run(request),
  };

  eventHandlerRef.current = handleEvent;

  useEffect(() => {
    return repositories.firestoreSql.subscribe((event) => eventHandlerRef.current(event));
  }, [repositories.firestoreSql]);

  function setSource(source: string) {
    store.update((current) => setFirestoreSqlSourceCommand(current, { source, tab: activeTab }));
  }

  function setContext(context: FirestoreSqlContext) {
    store.update((current) => setFirestoreSqlContextCommand(current, { context, tab: activeTab }));
  }

  function compile(): boolean {
    return compileFirestoreSqlCommand(store, env, {
      context: model.context,
      source: model.source,
      tab: activeTab,
    });
  }

  function run(): boolean {
    return runFirestoreSqlCommand(store, env, {
      interactionPath: activeTab ? activePath(activeTab) : 'sql/default',
      selectedTreeItemId,
      context: model.context,
      source: model.source,
      tab: activeTab,
      tabIsCurrent,
    });
  }

  function cancel(): boolean {
    return cancelFirestoreSqlCommand(store, env, { tab: activeTab });
  }

  function clearTab(tabId: string) {
    clearFirestoreSqlTabCommand(store, env, tabId);
  }

  function duplicateTab(sourceTabId: string, targetTabId: string) {
    duplicateFirestoreSqlTabCommand(store, sourceTabId, targetTabId);
  }

  return {
    compileResult: model.compileResult,
    context: model.context,
    contexts: state.contexts,
    isRunning: model.isRunning,
    result: model.result,
    runId: model.runId,
    runStartedAt: model.startedAt,
    source: activeTab ? model.source : FIRESTORE_SQL_SAMPLE_SOURCE,
    sources: state.sources,
    cancel,
    clearTab,
    compile,
    duplicateTab,
    isTabRunning,
    run,
    setContext,
    setSource,
  };

  function isTabRunning(tabId: string): boolean {
    return selectIsFirestoreSqlTabRunning(store.get(), tabId);
  }

  function handleEvent(event: FirestoreSqlRunEvent): void {
    receiveFirestoreSqlEventCommand(store, env, { event, tabIsCurrent });
  }

  function tabIsCurrent(tabId: string, connectionId: string): boolean {
    const tab = tabsStore.state.tabs.find((item) => item.id === tabId);
    return tab?.connectionId === connectionId;
  }
}
