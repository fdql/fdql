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

    expect(result.current).toEqual({ restored: true, snapshot: null });
    expect(tabsStore.state.tabs).toHaveLength(1);
    expect(tabsStore.state.tabs[0]).toMatchObject({ id: 'tab-firestore-query-1', title: 'orders' });
    expect(tabsStore.state.activeTabId).toBe('tab-firestore-query-1');
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
    drafts: {
      'tab-firestore-1': {
        filterField: '',
        filterOp: '==',
        filterValue: '',
        filters: [],
        limit: 25,
        path,
        sortDirection: 'asc',
        sortField: '',
      },
    },
    scripts: { 'tab-js-1': `return ${JSON.stringify(path)};` },
    tabsState: {
      activeTabId: 'tab-firestore-1',
      interactionHistory: [],
      interactionHistoryIndex: -1,
      tabs: [{
        connectionId: 'emu',
        history: [path],
        historyIndex: 0,
        id: 'tab-firestore-1',
        inspectorWidth: 360,
        kind: 'firestore-query',
        title: path,
      }],
    },
  };
}

function emptyWorkspaceSnapshot(): WorkspacePersistenceSnapshot {
  return {
    authFilter: '',
    drafts: {},
    scripts: {},
    tabsState: {
      activeTabId: '',
      interactionHistory: [],
      interactionHistoryIndex: 0,
      tabs: [],
    },
  };
}

function persistedWorkspace(tabId: string): PersistedWorkspaceState {
  return {
    version: 1,
    authFilter: '',
    drafts: {
      [tabId]: {
        filterField: '',
        filterOp: '==',
        filterValue: '',
        filters: [],
        limit: 7,
        path: 'customers',
        sortDirection: 'asc',
        sortField: '',
      },
    },
    scripts: {},
    tabsState: {
      activeTabId: tabId,
      interactionHistory: [],
      interactionHistoryIndex: 0,
      tabs: [{
        connectionId: 'emu',
        history: ['customers'],
        historyIndex: 0,
        id: tabId,
        inspectorWidth: 360,
        kind: 'firestore-query',
        title: 'customers',
      }],
    },
  };
}

function settingsSnapshot(
  workspaceState: unknown,
): Awaited<ReturnType<SettingsRepository['load']>> {
  return { workspaceState } as Awaited<ReturnType<SettingsRepository['load']>>;
}
