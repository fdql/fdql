import type { FdqlCompileResult, FdqlRunEvent, FdqlRunResult } from '@firebase-desk/repo-contracts';
import { useEffect, useMemo, useRef } from 'react';
import {
  cancelFdqlCommand,
  clearFdqlTabCommand,
  clearFdqlTabRuntimeCommand,
  duplicateFdqlTabCommand,
  type FdqlCommandEnvironment,
  receiveFdqlEventCommand,
  runFdqlCommand,
  setFdqlSourceCommand,
} from '../../app-core/fdql/fdqlCommands.ts';
import { selectFdqlTabModel, selectIsFdqlTabRunning } from '../../app-core/fdql/fdqlSelectors.ts';
import { createFdqlStore, type FdqlStore } from '../../app-core/fdql/fdqlStore.ts';
import { useAppCoreSelector } from '../../app-core/shared/reactStore.ts';
import { useRepositories } from '../RepositoryProvider.tsx';
import { activePath, tabActions, tabsStore, type WorkspaceTab } from '../stores/tabsStore.ts';

const DEFAULT_FDQL_SOURCE = `set fdql.readBudget = 5000

alias $orders = fs.collection("orders", ["status", "total"])

from $orders as o
fs where o.status = "paid"
fs order by o.total desc
fs limit 25

return fs.id(o) as id, o.status, o.total`;

interface UseFdqlTabStateInput {
  readonly activeTab: WorkspaceTab | undefined;
  readonly initialSources?: Readonly<Record<string, string>> | undefined;
  readonly selectedTreeItemId: string | null;
  readonly store?: FdqlStore | undefined;
}

export interface FdqlTabState {
  readonly compileResult: FdqlCompileResult | undefined;
  readonly isRunning: boolean;
  readonly result: FdqlRunResult | undefined;
  readonly runId: string | null;
  readonly runStartedAt: number | null;
  readonly source: string;
  readonly sources: Readonly<Record<string, string>>;
  readonly cancel: () => boolean;
  readonly clearTab: (tabId: string) => void;
  readonly clearTabRuntime: (tabId: string) => void;
  readonly duplicateTab: (sourceTabId: string, targetTabId: string) => void;
  readonly isTabRunning: (tabId: string) => boolean;
  readonly run: () => boolean;
  readonly setSource: (source: string) => void;
}

export function useFdqlTabState(
  {
    activeTab,
    initialSources,
    selectedTreeItemId,
    store: inputStore,
  }: UseFdqlTabStateInput,
): FdqlTabState {
  const store = useMemo(
    () => inputStore ?? createFdqlStore({ sources: initialSources }),
    [initialSources, inputStore],
  );
  const state = useAppCoreSelector(store, (snapshot) => snapshot);
  const eventHandlerRef = useRef<(event: FdqlRunEvent) => void>(() => {});
  const repositories = useRepositories();
  const model = selectFdqlTabModel(state, activeTab, DEFAULT_FDQL_SOURCE);
  const env: FdqlCommandEnvironment = {
    cancel: (runId) => repositories.fdql.cancel(runId),
    compile: (request) => repositories.fdql.compile(request),
    now: Date.now,
    randomToken: () => Math.random().toString(36).slice(2, 10),
    recordInteraction: tabActions.recordInteraction,
    run: (request) => repositories.fdql.run(request),
  };

  eventHandlerRef.current = handleEvent;

  useEffect(() => {
    return repositories.fdql.subscribe((event) => eventHandlerRef.current(event));
  }, [repositories.fdql]);

  function setSource(source: string) {
    store.update((current) => setFdqlSourceCommand(current, { source, tab: activeTab }));
  }

  function run(): boolean {
    return runFdqlCommand(store, env, {
      interactionPath: activeTab ? activePath(activeTab) : 'fdql/default',
      selectedTreeItemId,
      source: model.source,
      tab: activeTab,
      tabIsCurrent,
    });
  }

  function cancel(): boolean {
    return cancelFdqlCommand(store, env, { tab: activeTab });
  }

  function clearTab(tabId: string) {
    clearFdqlTabCommand(store, env, tabId);
  }

  function clearTabRuntime(tabId: string) {
    clearFdqlTabRuntimeCommand(store, env, tabId);
  }

  function duplicateTab(sourceTabId: string, targetTabId: string) {
    duplicateFdqlTabCommand(store, sourceTabId, targetTabId);
  }

  return {
    compileResult: model.compileResult,
    isRunning: model.isRunning,
    result: model.result,
    runId: model.runId,
    runStartedAt: model.startedAt,
    source: activeTab ? model.source : DEFAULT_FDQL_SOURCE,
    sources: state.sources,
    cancel,
    clearTab,
    clearTabRuntime,
    duplicateTab,
    isTabRunning,
    run,
    setSource,
  };

  function isTabRunning(tabId: string): boolean {
    return selectIsFdqlTabRunning(store.get(), tabId);
  }

  function handleEvent(event: FdqlRunEvent): void {
    receiveFdqlEventCommand(store, env, { event, tabIsCurrent });
  }

  function tabIsCurrent(tabId: string, connectionId: string): boolean {
    const tab = tabsStore.state.tabs.find((item) => item.id === tabId);
    return tab?.connectionId === connectionId;
  }
}
