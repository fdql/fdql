import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type SettingsRepository,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { type DataTableColumn } from '@firebase-desk/ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionLayoutKeyForPath, useResultTableLayout } from './resultTableLayout.ts';

const settingsSnapshot: SettingsSnapshot = {
  activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
  dataMode: 'mock',
  density: 'compact',
  firestoreFieldCatalogs: {},
  firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
  hotkeyOverrides: {},
  inspectorWidth: 360,
  resultTableLayouts: {},
  sidebarWidth: 320,
  theme: 'system',
  updates: DEFAULT_UPDATE_SETTINGS,
  workspaceState: null,
};

const columns: ReadonlyArray<DataTableColumn<{ id: string; }>> = [
  { id: 'id', header: 'ID', cell: () => null },
];

describe('result table layout keys', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes document ids from nested collection paths', () => {
    expect(collectionLayoutKeyForPath('orders/ord_1/skiers/skier_1/results')).toBe(
      'orders/skiers/results',
    );
  });

  it('uses the root collection name for document paths', () => {
    expect(collectionLayoutKeyForPath('orders/ord_1')).toBe('orders');
  });

  it('clears pending saves when unmounted', () => {
    vi.useFakeTimers();
    const settings: SettingsRepository = {
      load: vi.fn(async () => settingsSnapshot),
      save: vi.fn(async () => settingsSnapshot),
      getHotkeyOverrides: vi.fn(async () => ({})),
      setHotkeyOverrides: vi.fn(async () => undefined),
    };
    const { result, unmount } = renderHook(() =>
      useResultTableLayout({ columns, queryPath: 'orders', settings })
    );

    act(() => {
      result.current.saveLayout({ columnOrder: ['id'], columnSizing: { id: 180 } });
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(settings.save).not.toHaveBeenCalled();
  });

  it('reports settings load failures', async () => {
    const onSettingsError = vi.fn();
    const settings: SettingsRepository = {
      load: vi.fn(async () => {
        throw new Error('layout load failed');
      }),
      save: vi.fn(async () => settingsSnapshot),
      getHotkeyOverrides: vi.fn(async () => ({})),
      setHotkeyOverrides: vi.fn(async () => undefined),
    };

    renderHook(() =>
      useResultTableLayout({ columns, onSettingsError, queryPath: 'orders', settings })
    );

    await waitFor(() => expect(onSettingsError).toHaveBeenCalledWith('layout load failed'));
  });

  it('reports settings save failures', async () => {
    vi.useFakeTimers();
    const onSettingsError = vi.fn();
    const settings: SettingsRepository = {
      load: vi.fn(async () => settingsSnapshot),
      save: vi.fn(async () => {
        throw new Error('layout save failed');
      }),
      getHotkeyOverrides: vi.fn(async () => ({})),
      setHotkeyOverrides: vi.fn(async () => undefined),
    };
    const { result } = renderHook(() =>
      useResultTableLayout({ columns, onSettingsError, queryPath: 'orders', settings })
    );

    await act(async () => {
      result.current.saveLayout({ columnOrder: ['id'], columnSizing: { id: 180 } });
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSettingsError).toHaveBeenCalledWith('layout save failed');
  });
});
