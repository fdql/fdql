import { HotkeysProvider } from '@firebase-desk/hotkeys';
import { AppearanceProvider } from '@firebase-desk/product-ui';
import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityState } from '../../app-core/activity/activityState.ts';
import { createInitialActivityState } from '../../app-core/activity/activityState.ts';
import { createActivityStore } from '../../app-core/activity/activityStore.ts';
import { createFirestoreDraft } from '../../app-core/firestore/query/firestoreQueryDraft.ts';
import { defaultFirestoreInspectorUiState } from '../../app-core/firestore/query/firestoreQueryState.ts';
import {
  createMockRepositories,
  RepositoryProvider,
  type RepositorySet,
} from '../RepositoryProvider.tsx';
import { selectionActions } from '../stores/selectionStore.ts';
import { tabActions, tabsStore, type WorkspaceTabKind } from '../stores/tabsStore.ts';
import { type PersistedWorkspaceState } from '../workspacePersistence.ts';
import { useAppShellController } from './useAppShellController.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tabActions.reset();
  selectionActions.reset();
});

describe('useAppShellController integration', () => {
  it('changes theme through settings and records activity', async () => {
    const repositories = createMockRepositories();
    const appendActivity = vi.spyOn(repositories.activity, 'append');
    const { result } = renderController({ repositories });
    await waitForProjects(result);

    act(() => result.current.header.onModeChange('dark'));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await waitFor(() =>
      expect(appendActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'Change theme',
          area: 'settings',
          status: 'success',
        }),
      )
    );
  });

  it('exposes settings activity in the Activity drawer model', async () => {
    const { result } = renderController();
    await waitForProjects(result);

    act(() => result.current.header.onModeChange('dark'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    act(() => result.current.workspace.onActivityToggle());

    await waitFor(() =>
      expect(
        result.current.workspace.activity.entries.some((entry) => entry.action === 'Change theme'),
      ).toBe(true)
    );
  });

  it('clears an activity issue indicator only after Activity opens', async () => {
    const { result } = renderController({ activityState: activityIssueState() });
    await waitForProjects(result);

    expect(result.current.workspace.activity.buttonBadge?.label).toBe('failure');

    act(() => result.current.header.onModeChange('dark'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(result.current.workspace.activity.buttonBadge?.label).toBe('failure');

    act(() => result.current.workspace.onActivityToggle());

    await waitFor(() => expect(result.current.workspace.activity.buttonBadge).toBeNull());
  });

  it('surfaces invalid saved workspace state as workspace activity', async () => {
    const repositories = createMockRepositories();
    const appendActivity = vi.spyOn(repositories.activity, 'append');
    const { result } = renderController({ repositories, savedWorkspaceRaw: '{' });

    await waitFor(() =>
      expect(appendActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'Load workspace state',
          area: 'workspace',
          status: 'failure',
        }),
      )
    );
    await waitFor(() =>
      expect(result.current.workspace.lastAction).toMatch(/Workspace persistence failed/)
    );
  });

  it('cancels a running JS Query when closing its tab', async () => {
    const repositories = createMockRepositories();
    const run = vi.spyOn(repositories.scriptRunner, 'run').mockImplementation(
      () => new Promise(() => {}),
    );
    const cancel = vi.spyOn(repositories.scriptRunner, 'cancel');
    const { result } = renderController({
      initialTabs: [{ kind: 'js-query', connectionId: 'emu' }],
      repositories,
    });
    await waitForProjects(result);

    act(() => currentScript(result).onRun());

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const runId = run.mock.calls[0]?.[0].runId;
    const activeTabId = tabsStore.state.activeTabId;
    act(() => result.current.workspace.onCloseTab(activeTabId));
    act(() => result.current.dialogs.destructiveAction?.onConfirm());

    await waitFor(() => expect(cancel).toHaveBeenCalledWith(runId));
  });

  it('keeps a busy Firestore query tab open when closing it', async () => {
    const repositories = createMockRepositories();
    const runQuery = vi.spyOn(repositories.firestore, 'runQuery').mockImplementation(
      () => new Promise(() => {}),
    );
    const { result } = renderController({
      initialTabs: [{ kind: 'firestore-query', connectionId: 'emu' }],
      repositories,
    });
    await waitForProjects(result);
    const activeTabId = tabsStore.state.activeTabId;

    act(() => currentFirestore(result).onRunQuery());
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
    act(() => result.current.workspace.onCloseTab(activeTabId));
    act(() => result.current.dialogs.destructiveAction?.onConfirm());

    expect(tabsStore.state.tabs.some((tab) => tab.id === activeTabId)).toBe(true);
    expect(result.current.workspace.lastAction).toMatch(/Still loading/);
  });

  it('restores user tab state without restoring query results', async () => {
    const repositories = createMockRepositories();
    const runQuery = vi.spyOn(repositories.firestore, 'runQuery');
    const tabId = 'tab-firestore-query-7';
    const { result } = renderController({
      repositories,
      savedWorkspace: firestoreWorkspace(tabId),
    });

    await waitFor(() => expect(currentFirestore(result).draft.path).toBe('customers'));
    expect(currentFirestore(result).draft.limit).toBe(7);
    expect(currentFirestore(result).rows).toHaveLength(0);
    expect(runQuery).not.toHaveBeenCalled();

    act(() => currentFirestore(result).onRunQuery());
    await waitFor(() =>
      expect(runQuery).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'emu', path: 'customers' }),
        expect.objectContaining({ limit: 7 }),
      )
    );
  });

  it('restores script tabs when saved interaction history mentions closed tabs', async () => {
    const repositories = createMockRepositories();
    const run = vi.spyOn(repositories.scriptRunner, 'run');
    const { result } = renderController({
      repositories,
      savedWorkspace: scriptWorkspace(),
    });

    await waitFor(() => expect(result.current.workspace.activeTab?.kind).toBe('js-query'));
    act(() => currentScript(result).onRun());

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'emu', source: 'yield 1;' }),
      )
    );
    expect(result.current.workspace.lastAction).not.toMatch(/Workspace persistence failed/);
  });

  it('restores persisted workspace once in StrictMode', async () => {
    const tabId = 'tab-firestore-strict';
    const repositories = createMockRepositories();
    const restoreSpy = vi.spyOn(tabsStore, 'setState');
    const { result } = renderController({
      repositories,
      savedWorkspace: firestoreWorkspace(tabId),
      strictMode: true,
    });
    restoreSpy.mockClear();

    await waitFor(() => expect(currentFirestore(result).draft.path).toBe('customers'));
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    await waitFor(async () => {
      const raw = JSON.stringify((await repositories.settings.load()).workspaceState);
      expect(raw).toContain('customers');
      expect(raw).toContain('"limit":7');
    });
  });

  it('persists user tab state without query results', async () => {
    const repositories = createMockRepositories();
    const runQuery = vi.spyOn(repositories.firestore, 'runQuery');
    const { result } = renderController({
      initialTabs: [{ kind: 'firestore-query', connectionId: 'emu', path: 'orders' }],
      repositories,
    });
    await waitForProjects(result);

    act(() => currentFirestore(result).onRunQuery());
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
    act(() => currentFirestore(result).onDraftEdit({ type: 'path-set', path: 'customers' }));
    act(() => currentFirestore(result).onDraftEdit({ type: 'limit-set', limit: 9 }));

    await waitFor(async () => {
      const raw = JSON.stringify((await repositories.settings.load()).workspaceState);
      expect(raw).toContain('customers');
      expect(raw).toContain('"limit":9');
      expect(raw).not.toContain('queryRows');
      expect(raw).not.toContain('queryRequests');
      expect(raw).not.toContain('scriptResults');
      expect(raw).not.toContain('ord_1024');
    });
  });

  it('does not request account data without an explicit account tab', async () => {
    const repositories = createMockRepositories();
    const listUsers = vi.spyOn(repositories.auth, 'listUsers');
    const runQuery = vi.spyOn(repositories.firestore, 'runQuery');
    const { result } = renderController({ repositories });
    await waitForProjects(result);

    expect(result.current.workspace.activeTab).toBeUndefined();
    expect(listUsers).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('keeps canonical tab identity, settings, results, and history aligned', async () => {
    const repositories = createMockRepositories();
    const runQuery = repositories.firestore.runQuery.bind(repositories.firestore);
    vi.spyOn(repositories.firestore, 'runQuery').mockImplementation(async (query, request) =>
      query.path === 'auditLogs'
        ? {
          items: [{
            data: { severity: 'error' },
            hasSubcollections: false,
            id: 'audit_1',
            path: 'auditLogs/audit_1',
          }],
          nextCursor: null,
        }
        : await runQuery(query, request)
    );
    const { result } = renderController({
      initialTabs: [{ kind: 'firestore-query', connectionId: 'emu', path: 'orders' }],
      repositories,
    });
    await waitForProjects(result);
    const auditTabId = tabsStore.state.activeTabId;

    act(() => currentFirestore(result).onRunQuery());
    await waitFor(() => expect(currentFirestore(result).rows.length).toBeGreaterThan(0));

    act(() => currentFirestore(result).onDraftEdit({ type: 'path-set', path: 'auditLogs' }));
    await waitFor(() => {
      expect(currentFirestore(result).draft.path).toBe('auditLogs');
      expect(currentFirestore(result).rows).toEqual([]);
      expect(result.current.workspace.tabModels.find((tab) => tab.id === auditTabId)?.title)
        .toBe('auditLogs');
      expect(result.current.workspace.selectedTreeItemId).toBe('collection:emu:auditLogs');
    });
    act(() =>
      currentFirestore(result).onDraftEdit({
        type: 'filter-add',
        filter: { id: 'severity', field: 'severity', op: '==', value: '"error"' },
      })
    );
    act(() =>
      currentFirestore(result).onDraftEdit({
        type: 'sort-field-set',
        sortField: 'createdAt',
      })
    );
    act(() =>
      currentFirestore(result).onDraftEdit({
        type: 'sort-direction-set',
        sortDirection: 'asc',
      })
    );
    act(() => currentFirestore(result).onDraftEdit({ type: 'limit-set', limit: 7 }));

    act(() => result.current.sidebar.onSelectItem('collection:emu:orders'));
    await waitFor(() => {
      expect(currentFirestore(result).draft.path).toBe('orders');
      expect(tabsStore.state.tabs).toHaveLength(2);
      expect(result.current.workspace.activeTab?.connectionId).toBe('emu');
      expect(result.current.workspace.selectedTreeItemId).toBe('collection:emu:orders');
    });

    act(() => result.current.sidebar.onSelectItem('collection:emu:auditLogs'));
    await waitFor(() => {
      expect(tabsStore.state.activeTabId).toBe(auditTabId);
      expect(currentFirestore(result).draft).toMatchObject({
        path: 'auditLogs',
        limit: 7,
        sortField: 'createdAt',
        sortDirection: 'asc',
        filters: [expect.objectContaining({ id: 'severity', value: '"error"' })],
      });
      expect(result.current.workspace.selectedTreeItemId).toBe('collection:emu:auditLogs');
    });

    act(() => currentFirestore(result).onRunQuery());
    await waitFor(() => {
      expect(currentFirestore(result).rows).toHaveLength(1);
      expect(currentFirestore(result).resultQueryPath).toBe('auditLogs');
    });

    act(() => result.current.workspace.onConnectionChange('stage'));
    await waitFor(() => {
      expect(result.current.workspace.activeTab?.connectionId).toBe('stage');
      expect(currentFirestore(result).draft.path).toBe('auditLogs');
      expect(currentFirestore(result).rows).toEqual([]);
      expect(currentFirestore(result).resultQueryPath).toBeNull();
      expect(result.current.workspace.selectedTreeItemId).toBe('collection:stage:auditLogs');
    });

    act(() => result.current.header.onBack());
    await waitFor(() => {
      expect(result.current.workspace.activeTab?.connectionId).toBe('emu');
      expect(currentFirestore(result).draft).toMatchObject({
        path: 'auditLogs',
        limit: 7,
        sortField: 'createdAt',
        sortDirection: 'asc',
        filters: [expect.objectContaining({ id: 'severity', value: '"error"' })],
      });
    });
    act(() => result.current.header.onBack());
    await waitFor(() => expect(currentFirestore(result).draft.path).toBe('orders'));

    act(() => result.current.header.onForward());
    await waitFor(() => {
      expect(currentFirestore(result).draft).toMatchObject({
        path: 'auditLogs',
        limit: 7,
        sortField: 'createdAt',
        sortDirection: 'asc',
        filters: [expect.objectContaining({ id: 'severity', value: '"error"' })],
      });
      expect(result.current.workspace.activeTab?.connectionId).toBe('emu');
    });
    act(() => result.current.header.onForward());
    await waitFor(() => {
      expect(currentFirestore(result).draft).toMatchObject({
        path: 'auditLogs',
        limit: 7,
        sortField: 'createdAt',
        sortDirection: 'asc',
        filters: [expect.objectContaining({ id: 'severity', value: '"error"' })],
      });
      expect(result.current.workspace.activeTab?.connectionId).toBe('stage');
      expect(result.current.workspace.selectedTreeItemId).toBe('collection:stage:auditLogs');
    });
  });
});

function renderController(
  {
    activityState,
    dataMode = 'mock',
    initialTabs = [],
    repositories = createMockRepositories(),
    savedWorkspace,
    savedWorkspaceRaw,
    strictMode = false,
  }: {
    readonly activityState?: ActivityState | undefined;
    readonly dataMode?: 'live' | 'mock';
    readonly initialTabs?: ReadonlyArray<{
      readonly connectionId: string;
      readonly kind: WorkspaceTabKind;
      readonly path?: string;
    }>;
    readonly repositories?: RepositorySet;
    readonly savedWorkspace?: PersistedWorkspaceState;
    readonly savedWorkspaceRaw?: unknown;
    readonly strictMode?: boolean;
  } = {},
) {
  if (savedWorkspaceRaw !== undefined) {
    void repositories.settings.save({ workspaceState: savedWorkspaceRaw });
  }
  if (savedWorkspace) {
    void repositories.settings.save({ workspaceState: savedWorkspace });
  }
  tabActions.reset();
  selectionActions.reset();
  for (const tab of initialTabs) tabActions.openTab(tab);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const activityStore = activityState ? createActivityStore(activityState) : undefined;
  return renderHook(() => useAppShellController({ activityStore, appVersion: '0.1.0', dataMode }), {
    wrapper: ({ children }: { readonly children: ReactNode; }) => (
      <MaybeStrictMode strictMode={strictMode}>
        <RepositoryProvider repositories={repositories}>
          <HotkeysProvider settings={repositories.settings}>
            <AppearanceProvider settings={repositories.settings}>
              {children}
            </AppearanceProvider>
          </HotkeysProvider>
        </RepositoryProvider>
      </MaybeStrictMode>
    ),
  });
}

function MaybeStrictMode(
  { children, strictMode }: { readonly children: ReactNode; readonly strictMode: boolean; },
) {
  return strictMode ? <StrictMode>{children}</StrictMode> : <>{children}</>;
}

async function waitForProjects(
  result: ReturnType<typeof renderController>['result'],
) {
  await waitFor(() => expect(result.current.workspace.projects.length).toBeGreaterThan(0));
}

function currentFirestore(
  result: ReturnType<typeof renderController>['result'],
) {
  const tabView = result.current.tabView;
  if (!tabView) throw new Error('Expected an active tab view.');
  return tabView.firestore;
}

function currentScript(
  result: ReturnType<typeof renderController>['result'],
) {
  const tabView = result.current.tabView;
  if (!tabView) throw new Error('Expected an active tab view.');
  return tabView.script;
}

function activityIssueState(): ActivityState {
  return createInitialActivityState({
    unreadIssue: {
      action: 'Run query',
      area: 'firestore',
      id: 'activity-test-issue',
      status: 'failure',
      summary: 'Failed to load orders',
      timestamp: '2026-04-29T00:00:00.000Z',
    },
  });
}

function firestoreWorkspace(tabId: string): PersistedWorkspaceState {
  const draft: FirestoreQueryDraft = {
    ...createFirestoreDraft('customers'),
    filters: [{ id: 'filter-1', field: 'plan', op: '==', value: '"team"' }],
    filterField: 'plan',
    filterValue: '"team"',
    sortField: 'lastSeenAt',
    limit: 7,
  };
  return {
    version: 2,
    authFilter: '',
    scripts: {},
    tabsState: {
      activeTabId: tabId,
      interactionHistory: [{
        activeTabId: tabId,
        location: { kind: 'firestore-query', connectionId: 'emu', draft },
        selectedTreeItemId: 'collection:emu:customers',
      }],
      interactionHistoryIndex: 0,
      selectedTreeItemId: 'collection:emu:customers',
      tabs: [{
        id: tabId,
        kind: 'firestore-query',
        connectionId: 'emu',
        draft,
        inspectorUi: defaultFirestoreInspectorUiState(),
        inspectorWidth: 360,
      }],
    },
  };
}

function scriptWorkspace(): PersistedWorkspaceState {
  const firestoreDraft = createFirestoreDraft('orders');
  return {
    version: 2,
    authFilter: '',
    scripts: { 'tab-js-9': 'yield 1;' },
    tabsState: {
      activeTabId: 'tab-js-9',
      interactionHistory: [
        {
          activeTabId: 'tab-firestore-8',
          location: {
            kind: 'firestore-query',
            connectionId: 'emu',
            draft: firestoreDraft,
          },
          selectedTreeItemId: 'collection:emu:orders',
        },
        {
          activeTabId: 'closed-tab',
          location: {
            kind: 'firestore-query',
            connectionId: 'emu',
            draft: createFirestoreDraft('closed'),
          },
          selectedTreeItemId: 'collection:emu:closed',
        },
      ],
      interactionHistoryIndex: 1,
      selectedTreeItemId: 'script:emu',
      tabs: [
        {
          id: 'tab-firestore-8',
          kind: 'firestore-query',
          connectionId: 'emu',
          draft: firestoreDraft,
          inspectorUi: defaultFirestoreInspectorUiState(),
          inspectorWidth: 360,
        },
        {
          id: 'tab-js-9',
          kind: 'js-query',
          title: 'JS Query',
          connectionId: 'emu',
          history: ['scripts/default'],
          historyIndex: 0,
          inspectorWidth: 360,
        },
      ],
    },
  };
}
