// @vitest-environment jsdom

import type { SettingsRepository } from '@firebase-desk/repo-contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tabActions, tabsStore } from '../stores/tabsStore.ts';
import type { PersistedWorkspaceState } from '../workspacePersistence.ts';
import {
  usePersistedWorkspaceState,
  usePersistWorkspaceSnapshot,
  type WorkspacePersistenceSnapshot,
} from './usePersistedWorkspaceState.ts';

describe('usePersistWorkspaceSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tabActions.reset();
  });

  afterEach(() => {
    tabActions.reset();
    vi.useRealTimers();
  });

  it('skips the initial restore snapshot and debounces later saves', async () => {
    const settings = settingsSaveSpy();
    const { rerender } = renderHook(
      (props: { readonly snapshot: WorkspacePersistenceSnapshot; }) =>
        usePersistWorkspaceSnapshot(props.snapshot, {
          debounceMs: 50,
          enabled: true,
          settings,
        }),
      { initialProps: { snapshot: snapshot('orders') } },
    );

    expect(settings.save).not.toHaveBeenCalled();

    rerender({ snapshot: snapshot('customers') });
    rerender({ snapshot: snapshot('invoices') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(settings.save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(settings.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(settings.save.mock.calls[0]?.[0].workspaceState)).toContain('invoices');
    expect(JSON.stringify(settings.save.mock.calls[0]?.[0].workspaceState)).not.toContain(
      'customers',
    );
  });

  it('does not resave equivalent snapshots', async () => {
    const settings = settingsSaveSpy();
    const { rerender } = renderHook(
      (props: { readonly snapshot: WorkspacePersistenceSnapshot; }) =>
        usePersistWorkspaceSnapshot(props.snapshot, {
          debounceMs: 50,
          enabled: true,
          settings,
        }),
      { initialProps: { snapshot: snapshot('orders') } },
    );

    rerender({ snapshot: snapshot('orders') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(settings.save).not.toHaveBeenCalled();

    rerender({ snapshot: snapshot('customers') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(settings.save).toHaveBeenCalledTimes(1);

    rerender({ snapshot: snapshot('customers') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(settings.save).toHaveBeenCalledTimes(1);
  });

  it('flushes the queued snapshot when unmounted', async () => {
    const settings = settingsSaveSpy();
    const { rerender, unmount } = renderHook(
      (props: { readonly snapshot: WorkspacePersistenceSnapshot; }) =>
        usePersistWorkspaceSnapshot(props.snapshot, {
          debounceMs: 50,
          enabled: true,
          settings,
        }),
      { initialProps: { snapshot: snapshot('orders') } },
    );

    rerender({ snapshot: snapshot('customers') });
    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(settings.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(settings.save.mock.calls[0]?.[0].workspaceState)).toContain(
      'customers',
    );
  });

  it('saves an empty workspace immediately', async () => {
    const settings = settingsSaveSpy();
    const { rerender } = renderHook(
      (props: { readonly snapshot: WorkspacePersistenceSnapshot; }) =>
        usePersistWorkspaceSnapshot(props.snapshot, {
          debounceMs: 50,
          enabled: true,
          settings,
        }),
      { initialProps: { snapshot: snapshot('orders') } },
    );

    rerender({ snapshot: emptyWorkspaceSnapshot() });
    await act(async () => {
      await Promise.resolve();
    });

    expect(settings.save).toHaveBeenCalledTimes(1);
    expect(settings.save.mock.calls[0]?.[0]).toEqual({
      workspaceState: null,
      workspaceStateClearedAt: expect.any(Number),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(settings.save).toHaveBeenCalledTimes(1);
  });

  it('can persist the first enabled snapshot', async () => {
    const settings = settingsSaveSpy();
    renderHook(() =>
      usePersistWorkspaceSnapshot(snapshot('orders'), {
        debounceMs: 50,
        enabled: true,
        settings,
        skipInitialSave: false,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(settings.save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(JSON.stringify(settings.save.mock.calls[0]?.[0].workspaceState)).toContain('orders');
  });
});

describe('usePersistedWorkspaceState', () => {
  beforeEach(() => {
    tabActions.reset();
  });

  afterEach(() => {
    tabActions.reset();
  });

  it('restores nested Firestore tab state', async () => {
    const settings = {
      load: vi.fn(async () => settingsSnapshot(persistedWorkspace('tab-firestore-1'))),
    };

    const { result } = renderHook(() => usePersistedWorkspaceState({ settings }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.restored).toBe(true);
    expect(tabsStore.state.tabs[0]).toMatchObject({
      id: 'tab-firestore-1',
      draft: { path: 'customers' },
      inspectorUi: { overviewCollapsed: false, resultView: 'json' },
    });
  });

  it('writes migrated version 1 state back once as version 2', async () => {
    const save = vi.fn(async (patch: Parameters<SettingsRepository['save']>[0]) =>
      settingsSnapshot(patch.workspaceState)
    );
    const settings = {
      load: vi.fn(async () => settingsSnapshot(persistedWorkspaceV1())),
      save,
    };

    renderHook(() => usePersistedWorkspaceState({ settings }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].workspaceState).toMatchObject({
      version: 2,
      tabsState: {
        tabs: [{ draft: { path: 'customers' }, kind: 'firestore-query' }],
      },
    });
  });

  it('does not restore stale workspace after a tab opens', async () => {
    let resolveLoad!: (snapshot: Awaited<ReturnType<SettingsRepository['load']>>) => void;
    const loadPromise = new Promise<Awaited<ReturnType<SettingsRepository['load']>>>((resolve) => {
      resolveLoad = resolve;
    });
    const settings = { load: vi.fn(() => loadPromise) };
    const { result } = renderHook(() => usePersistedWorkspaceState({ settings }));

    act(() => {
      tabActions.openTab({ kind: 'firestore-query', connectionId: 'emu', path: 'orders' });
    });
    await act(async () => {
      resolveLoad(settingsSnapshot(persistedWorkspace('tab-stale')));
      await loadPromise;
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      persistenceEnabled: true,
      recoveryDiagnostic: null,
      restored: true,
      snapshot: null,
    });
    expect(tabsStore.state.tabs).toHaveLength(1);
    expect(tabsStore.state.tabs[0]).toMatchObject({
      id: 'tab-firestore-query-1',
      draft: { path: 'orders' },
    });
    expect(tabsStore.state.activeTabId).toBe('tab-firestore-query-1');
  });

  it('disables persistence for an unknown future version', async () => {
    const onError = vi.fn();
    const settings = {
      load: vi.fn(async () => settingsSnapshot({ version: 99, future: true })),
    };

    const { result } = renderHook(() => usePersistedWorkspaceState({ onError, settings }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toMatchObject({
      persistenceEnabled: false,
      restored: true,
      snapshot: null,
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('version 99'),
      operation: 'load',
    }));
  });
});

function settingsSaveSpy(): Pick<SettingsRepository, 'save'> & {
  readonly save: ReturnType<typeof vi.fn<SettingsRepository['save']>>;
} {
  return {
    save: vi.fn(async () => ({}) as never),
  };
}

function snapshot(path: string): WorkspacePersistenceSnapshot {
  return {
    authFilter: '',
    scripts: { 'tab-js-1': `return ${JSON.stringify(path)};` },
    tabsState: {
      activeTabId: 'tab-firestore-1',
      interactionHistory: [],
      interactionHistoryIndex: 0,
      selectedTreeItemId: null,
      tabs: [{
        connectionId: 'emu',
        draft: {
          filterField: '',
          filterOp: '==',
          filterValue: '',
          filters: [],
          limit: 25,
          path,
          sortDirection: 'asc',
          sortField: '',
        },
        id: 'tab-firestore-1',
        inspectorUi: {
          overviewCollapsed: false,
          resultView: 'tree',
          resultTreeExpandedIds: null,
          sections: {
            fieldsInResults: false,
            jsonContext: true,
            selectionPreview: true,
          },
          selectionPreviewExpandedPathsByDocumentPath: {},
        },
        inspectorWidth: 360,
        kind: 'firestore-query',
      }],
    },
  };
}

function emptyWorkspaceSnapshot(): WorkspacePersistenceSnapshot {
  return {
    authFilter: '',
    scripts: {},
    tabsState: {
      activeTabId: '',
      interactionHistory: [],
      interactionHistoryIndex: 0,
      selectedTreeItemId: null,
      tabs: [],
    },
  };
}

function persistedWorkspace(tabId: string): PersistedWorkspaceState {
  return {
    version: 2,
    authFilter: '',
    scripts: {},
    tabsState: {
      activeTabId: tabId,
      interactionHistory: [],
      interactionHistoryIndex: 0,
      selectedTreeItemId: null,
      tabs: [{
        connectionId: 'emu',
        draft: {
          filterField: '',
          filterOp: '==',
          filterValue: '',
          filters: [],
          limit: 7,
          path: 'customers',
          sortDirection: 'asc',
          sortField: '',
        },
        id: tabId,
        inspectorUi: {
          overviewCollapsed: false,
          resultView: 'json',
          resultTreeExpandedIds: null,
          sections: {
            fieldsInResults: false,
            jsonContext: true,
            selectionPreview: true,
          },
          selectionPreviewExpandedPathsByDocumentPath: {},
        },
        inspectorWidth: 360,
        kind: 'firestore-query',
      }],
    },
  };
}

function persistedWorkspaceV1() {
  return {
    version: 1,
    authFilter: '',
    scripts: {},
    drafts: {
      'tab-firestore-1': {
        filterField: '',
        filterOp: '==' as const,
        filterValue: '',
        filters: [],
        limit: 7,
        path: 'customers',
        sortDirection: 'asc' as const,
        sortField: '',
      },
    },
    tabsState: {
      activeTabId: 'tab-firestore-1',
      interactionHistory: [{
        activeTabId: 'tab-firestore-1',
        path: 'orders',
        selectedTreeItemId: 'collection:emu:orders',
      }],
      interactionHistoryIndex: 0,
      tabs: [{
        connectionId: 'emu',
        history: ['orders'],
        historyIndex: 0,
        id: 'tab-firestore-1',
        inspectorWidth: 360,
        kind: 'firestore-query',
        title: 'stale title',
      }],
    },
  };
}

function settingsSnapshot(
  workspaceState: unknown,
): Awaited<ReturnType<SettingsRepository['load']>> {
  return { workspaceState } as Awaited<ReturnType<SettingsRepository['load']>>;
}
