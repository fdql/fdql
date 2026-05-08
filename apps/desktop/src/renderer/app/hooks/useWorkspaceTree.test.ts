import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRepositories } from '../RepositoryProvider.tsx';
import { selectionActions, selectionStore } from '../stores/selectionStore.ts';
import { tabActions, type WorkspaceTab } from '../stores/tabsStore.ts';
import { projectNodeId } from '../workspaceModel.ts';
import { useWorkspaceTree } from './useWorkspaceTree.ts';

vi.mock('../RepositoryProvider.tsx', () => ({
  useRepositories: vi.fn(),
}));

const projects: ReadonlyArray<ProjectSummary> = [
  {
    id: 'emu',
    name: 'Local Emulator',
    projectId: 'demo-local',
    target: 'emulator',
    emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
    hasCredential: false,
    credentialEncrypted: null,
    createdAt: '2026-04-27T00:00:00.000Z',
  },
];

const activeTab: WorkspaceTab = {
  id: 'tab-firestore-1',
  kind: 'firestore-query',
  title: 'orders',
  connectionId: 'emu',
  history: ['orders'],
  historyIndex: 0,
  inspectorWidth: 360,
};

describe('useWorkspaceTree', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    selectionActions.reset();
    vi.mocked(useRepositories).mockReturnValue({
      firestore: {
        listRootCollections: vi.fn().mockResolvedValue([{ id: 'orders', path: 'orders' }]),
      },
    } as unknown as ReturnType<typeof useRepositories>);
  });

  it('selects collection tree items and records tab interaction', () => {
    const openFirestoreTab = vi.fn(() => 'tab-firestore-2');
    const openToolTab = vi.fn(() => 'tab-tool');
    const recordInteraction = vi.spyOn(tabActions, 'recordInteraction').mockImplementation(
      () => {},
    );
    const setLastAction = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceTree({
        activeTab,
        openFirestoreTab,
        openFirestoreTabInNewTab: vi.fn(),
        openToolTab,
        projects,
        selectedTreeItemId: null,
        setLastAction,
      })
    );

    act(() => result.current.handleSelectItem('collection:emu:orders'));

    expect(selectionStore.state.treeItemId).toBe('collection:emu:orders');
    expect(openFirestoreTab).toHaveBeenCalledWith('emu', 'orders');
    expect(recordInteraction).toHaveBeenCalledWith({
      activeTabId: 'tab-firestore-2',
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
    expect(setLastAction).toHaveBeenCalledWith('Opened orders');
  });

  it('loads project tools and firestore roots through the repository', async () => {
    const listRootCollections = vi.fn().mockResolvedValue([{ id: 'orders', path: 'orders' }]);
    vi.mocked(useRepositories).mockReturnValue({
      firestore: { listRootCollections },
    } as unknown as ReturnType<typeof useRepositories>);
    const { result } = renderHook(() =>
      useWorkspaceTree({
        activeTab,
        openFirestoreTab: vi.fn(),
        openFirestoreTabInNewTab: vi.fn(),
        openToolTab: vi.fn(),
        projects,
        selectedTreeItemId: null,
        setLastAction: vi.fn(),
      })
    );

    act(() => result.current.handleToggleItem(projectNodeId('emu')));
    await waitFor(() =>
      expect(result.current.treeItems.some((item) => item.id === 'firestore:emu')).toBe(true)
    );

    act(() => result.current.handleToggleItem('firestore:emu'));
    await waitFor(() =>
      expect(result.current.treeItems.some((item) => item.id === 'collection:emu:orders')).toBe(
        true,
      )
    );

    expect(listRootCollections).toHaveBeenCalledWith('emu');
  });

  it('refreshes loaded firestore roots on demand', async () => {
    const listRootCollections = vi.fn()
      .mockResolvedValueOnce([{ id: 'orders', path: 'orders' }])
      .mockResolvedValueOnce([{ id: 'customers', path: 'customers' }]);
    vi.mocked(useRepositories).mockReturnValue({
      firestore: { listRootCollections },
    } as unknown as ReturnType<typeof useRepositories>);
    const { result } = renderHook(() =>
      useWorkspaceTree({
        activeTab,
        openFirestoreTab: vi.fn(),
        openFirestoreTabInNewTab: vi.fn(),
        openToolTab: vi.fn(),
        projects,
        selectedTreeItemId: null,
        setLastAction: vi.fn(),
      })
    );

    act(() => result.current.handleToggleItem(projectNodeId('emu')));
    act(() => result.current.handleToggleItem('firestore:emu'));
    await waitFor(() =>
      expect(result.current.treeItems.some((item) => item.id === 'collection:emu:orders')).toBe(
        true,
      )
    );

    await act(async () => {
      await result.current.refreshLoadedRoots();
    });

    await waitFor(() =>
      expect(result.current.treeItems.some((item) => item.id === 'collection:emu:customers')).toBe(
        true,
      )
    );
    expect(listRootCollections).toHaveBeenCalledTimes(2);
  });

  it('surfaces firestore root load errors and retries them', async () => {
    const listRootCollections = vi.fn()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce([{ id: 'orders', path: 'orders' }]);
    vi.mocked(useRepositories).mockReturnValue({
      firestore: { listRootCollections },
    } as unknown as ReturnType<typeof useRepositories>);
    const setLastAction = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceTree({
        activeTab,
        openFirestoreTab: vi.fn(),
        openFirestoreTabInNewTab: vi.fn(),
        openToolTab: vi.fn(),
        projects,
        selectedTreeItemId: null,
        setLastAction,
      })
    );

    act(() => result.current.handleToggleItem(projectNodeId('emu')));
    await waitFor(() =>
      expect(result.current.treeItems.some((item) => item.id === 'firestore:emu')).toBe(true)
    );

    act(() => result.current.handleToggleItem('firestore:emu'));
    await waitFor(() =>
      expect(result.current.treeItems).toContainEqual(expect.objectContaining({
        id: 'status:firestore:emu',
        label: 'Load failed',
        secondary: expect.stringContaining('permission denied'),
        status: 'error',
      }))
    );

    act(() => result.current.handleRefreshItem('firestore:emu'));
    await waitFor(() =>
      expect(result.current.treeItems.some((item) => item.id === 'collection:emu:orders')).toBe(
        true,
      )
    );

    expect(listRootCollections).toHaveBeenCalledTimes(2);
    expect(setLastAction).toHaveBeenCalledWith('Retried Local Emulator');
    expect(setLastAction).toHaveBeenCalledWith(
      expect.stringContaining('Firestore load failed: permission denied'),
    );
  });

  it('keeps script click reusing a tab and script double click opening a new tab', () => {
    const openToolTab = vi.fn((
      _kind: string,
      _connectionId: string,
      options?: { readonly newTab?: boolean; },
    ) => options?.newTab ? 'tab-js-new' : 'tab-js-reused');
    const recordInteraction = vi.spyOn(tabActions, 'recordInteraction').mockImplementation(
      () => {},
    );
    const { result } = renderHook(() =>
      useWorkspaceTree({
        activeTab,
        openFirestoreTab: vi.fn(),
        openFirestoreTabInNewTab: vi.fn(),
        openToolTab,
        projects,
        selectedTreeItemId: null,
        setLastAction: vi.fn(),
      })
    );

    act(() => result.current.handleSelectItem('script:emu'));

    expect(openToolTab).toHaveBeenCalledWith('js-query', 'emu', { newTab: false });
    expect(recordInteraction).toHaveBeenCalledWith({
      activeTabId: 'tab-js-reused',
      path: 'scripts/default',
      selectedTreeItemId: 'script:emu',
    });

    act(() => result.current.handleOpenItem('script:emu'));

    expect(openToolTab).toHaveBeenCalledWith('js-query', 'emu', { newTab: true });
    expect(recordInteraction).toHaveBeenCalledWith({
      activeTabId: 'tab-js-new',
      path: 'scripts/default',
      selectedTreeItemId: 'script:emu',
    });
  });

  it('opens fdql double clicks in a new tab', () => {
    const openToolTab = vi.fn((
      _kind: string,
      _connectionId: string,
      options?: { readonly newTab?: boolean; },
    ) => options?.newTab ? 'tab-fdql-new' : 'tab-fdql-reused');
    const recordInteraction = vi.spyOn(tabActions, 'recordInteraction').mockImplementation(
      () => {},
    );
    const { result } = renderHook(() =>
      useWorkspaceTree({
        activeTab,
        openFirestoreTab: vi.fn(),
        openFirestoreTabInNewTab: vi.fn(),
        openToolTab,
        projects,
        selectedTreeItemId: null,
        setLastAction: vi.fn(),
      })
    );

    act(() => result.current.handleSelectItem('fdql:emu'));
    act(() => result.current.handleOpenItem('fdql:emu'));

    expect(openToolTab).toHaveBeenCalledWith('fdql', 'emu', { newTab: false });
    expect(openToolTab).toHaveBeenCalledWith('fdql', 'emu', { newTab: true });
    expect(recordInteraction).toHaveBeenCalledWith({
      activeTabId: 'tab-fdql-new',
      path: 'fdql/default',
      selectedTreeItemId: 'fdql:emu',
    });
  });

  it('opens collection double clicks in a new tab', () => {
    const openFirestoreTab = vi.fn(() => 'tab-firestore-reused');
    const openFirestoreTabInNewTab = vi.fn(() => 'tab-firestore-new');
    const recordInteraction = vi.spyOn(tabActions, 'recordInteraction').mockImplementation(
      () => {},
    );
    const { result } = renderHook(() =>
      useWorkspaceTree({
        activeTab,
        openFirestoreTab,
        openFirestoreTabInNewTab,
        openToolTab: vi.fn(),
        projects,
        selectedTreeItemId: null,
        setLastAction: vi.fn(),
      })
    );

    act(() => result.current.handleSelectItem('collection:emu:orders'));
    act(() => result.current.handleOpenItem('collection:emu:orders'));

    expect(openFirestoreTab).toHaveBeenCalledWith('emu', 'orders');
    expect(openFirestoreTabInNewTab).toHaveBeenCalledWith('emu', 'orders');
    expect(recordInteraction).toHaveBeenCalledWith({
      activeTabId: 'tab-firestore-new',
      path: 'orders',
      selectedTreeItemId: 'collection:emu:orders',
    });
  });
});
