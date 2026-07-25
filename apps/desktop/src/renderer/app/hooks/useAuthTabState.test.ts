// @vitest-environment jsdom

import type { AuthUser, ProjectSummary } from '@firebase-desk/repo-contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultFirestoreInspectorUiState } from '../../app-core/firestore/query/firestoreQueryState.ts';
import { useRepositories } from '../RepositoryProvider.tsx';
import type { WorkspaceTab } from '../stores/tabsStore.ts';
import { DEFAULT_FIRESTORE_DRAFT } from '../workspaceModel.ts';
import { useAuthTabState } from './useAuthTabState.ts';

vi.mock('../RepositoryProvider.tsx', () => ({
  useRepositories: vi.fn(),
}));

const tab: WorkspaceTab = {
  id: 'tab-auth-1',
  kind: 'auth-users',
  title: 'Auth',
  connectionId: 'emu',
  history: ['auth/users'],
  historyIndex: 0,
  inspectorWidth: 360,
};

const ada: AuthUser = {
  uid: 'u_ada',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  provider: 'password',
  disabled: false,
  customClaims: {},
};

const grace: AuthUser = {
  uid: 'u_grace',
  email: 'grace@example.com',
  displayName: 'Grace Hopper',
  provider: 'google.com',
  disabled: false,
  customClaims: {},
};

describe('useAuthTabState', () => {
  let auth: {
    listUsers: ReturnType<typeof vi.fn>;
    searchUsers: ReturnType<typeof vi.fn>;
    setCustomClaims: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    auth = {
      listUsers: vi.fn(async () => ({ items: [grace], nextCursor: { token: 'next' } })),
      searchUsers: vi.fn(async (_projectId, query) => query ? [ada] : []),
      setCustomClaims: vi.fn(async (_projectId, uid, claims) => ({
        ...grace,
        customClaims: claims,
        uid,
      })),
    };
    vi.mocked(useRepositories).mockReturnValue({ auth } as never);
  });

  it('uses paged users until a search filter is present', async () => {
    const { result } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        recordActivity: vi.fn(),
        selectedUserId: 'u_grace',
      })
    );

    await waitFor(() => expect(result.current.users).toEqual([grace]));
    expect(result.current.selectedUser).toEqual(grace);

    act(() => result.current.setAuthFilter('ada'));

    await waitFor(() => expect(result.current.users).toEqual([ada]));
    expect(result.current.selectedUser).toBeNull();
    expect(auth.searchUsers).toHaveBeenLastCalledWith('emu', 'ada');
  });

  it('loads more only when not searching and can clear the filter', async () => {
    auth.listUsers
      .mockResolvedValueOnce({ items: [grace], nextCursor: { token: 'next' } })
      .mockResolvedValueOnce({ items: [ada], nextCursor: null });
    const { result } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        initialAuthFilter: 'ada',
        recordActivity: vi.fn(),
        selectedUserId: null,
      })
    );

    act(() => result.current.loadMore());
    expect(auth.listUsers).not.toHaveBeenCalled();

    act(() => result.current.clear());
    await waitFor(() => expect(auth.listUsers).toHaveBeenCalledTimes(1));
    act(() => result.current.loadMore());

    await waitFor(() => expect(auth.listUsers).toHaveBeenCalledTimes(2));
    expect(auth.listUsers).toHaveBeenLastCalledWith('emu', {
      cursor: { token: 'next' },
      limit: 25,
    });
  });

  it('recreates the default store when the restored initial filter changes', async () => {
    let initialAuthFilter = 'ada';
    const { rerender, result } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        initialAuthFilter,
        recordActivity: vi.fn(),
        selectedUserId: null,
      })
    );

    expect(result.current.authFilter).toBe('ada');
    await waitFor(() => expect(auth.searchUsers).toHaveBeenLastCalledWith('emu', 'ada'));

    initialAuthFilter = 'grace';
    rerender();

    expect(result.current.authFilter).toBe('grace');
    await waitFor(() => expect(auth.searchUsers).toHaveBeenLastCalledWith('emu', 'grace'));
  });

  it('refreshes the current auth query from the first page', async () => {
    const { result } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        recordActivity: vi.fn(),
        selectedUserId: null,
      })
    );

    await waitFor(() => expect(auth.listUsers).toHaveBeenCalledTimes(1));
    act(() => result.current.refetch());

    await waitFor(() => expect(auth.listUsers).toHaveBeenCalledTimes(2));
    expect(auth.listUsers).toHaveBeenLastCalledWith('emu', { limit: 25 });
  });

  it('keeps user lists isolated by project and does not reload loaded tabs on revisit', async () => {
    auth.listUsers.mockImplementation(async (projectId) => ({
      items: projectId === 'prod' ? [ada] : [grace],
      nextCursor: null,
    }));
    let activeProject = project;
    let activeTab: WorkspaceTab | undefined = tab;
    const { rerender, result } = renderHook(() =>
      useAuthTabState({
        activeProject,
        activeTab,
        recordActivity: vi.fn(),
        selectedUserId: null,
      })
    );

    await waitFor(() => expect(result.current.users).toEqual([grace]));
    expect(auth.listUsers).toHaveBeenCalledTimes(1);

    activeProject = prodProject;
    activeTab = { ...tab, connectionId: 'prod', id: 'tab-auth-prod' };
    rerender();

    expect(result.current.users).toEqual([]);
    await waitFor(() => expect(result.current.users).toEqual([ada]));
    expect(auth.listUsers).toHaveBeenCalledTimes(2);

    activeTab = firestoreTab();
    rerender();
    activeProject = project;
    activeTab = tab;
    rerender();

    expect(result.current.users).toEqual([grace]);
    await Promise.resolve();
    expect(auth.listUsers).toHaveBeenCalledTimes(2);
  });

  it('records successful initial user loads once', async () => {
    const recordActivity = vi.fn();
    const { rerender } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        recordActivity,
        selectedUserId: null,
      })
    );

    await waitFor(() => expect(recordActivity).toHaveBeenCalledTimes(1));
    rerender();

    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Load users',
      area: 'auth',
      metadata: expect.objectContaining({ resultCount: 1 }),
      status: 'success',
    }));
  });

  it('records successful user searches once per filter result', async () => {
    const recordActivity = vi.fn();
    const { result } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        recordActivity,
        selectedUserId: null,
      })
    );

    await waitFor(() => expect(recordActivity).toHaveBeenCalledTimes(1));
    act(() => result.current.setAuthFilter('ada'));

    await waitFor(() => expect(recordActivity).toHaveBeenCalledTimes(2));
    expect(recordActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'Search users',
      metadata: expect.objectContaining({ filter: 'ada', resultCount: 1 }),
      status: 'success',
    }));
  });

  it('saves claims and updates the selected user', async () => {
    const setCustomClaims = vi.fn().mockResolvedValue({
      ...grace,
      customClaims: { role: 'owner' },
    });
    auth.setCustomClaims = setCustomClaims;
    const { result } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        recordActivity: vi.fn(),
        selectedUserId: 'u_grace',
      })
    );

    await act(async () => {
      await result.current.saveCustomClaims('u_grace', { role: 'owner' });
    });

    expect(setCustomClaims).toHaveBeenCalledWith('emu', 'u_grace', { role: 'owner' });
    expect(result.current.selectedUser?.customClaims).toEqual({ role: 'owner' });
  });

  it('records load failures from the auth controller once per error', async () => {
    const recordActivity = vi.fn();
    auth.listUsers.mockRejectedValue(new Error('auth down'));

    const { rerender } = renderHook(() =>
      useAuthTabState({
        activeProject: project,
        activeTab: tab,
        recordActivity,
        selectedUserId: null,
      })
    );

    await waitFor(() => expect(recordActivity).toHaveBeenCalledTimes(1));
    rerender();

    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Load users',
      error: { message: 'auth down' },
      status: 'failure',
    }));
  });
});

function firestoreTab(): WorkspaceTab {
  return {
    connectionId: 'prod',
    draft: DEFAULT_FIRESTORE_DRAFT,
    id: 'tab-firestore-prod',
    inspectorUi: defaultFirestoreInspectorUiState(),
    inspectorWidth: 360,
    kind: 'firestore-query',
  };
}

const project: ProjectSummary = {
  id: 'emu',
  name: 'Local Emulator',
  projectId: 'emu',
  target: 'emulator',
  emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
  hasCredential: false,
  credentialEncrypted: null,
  createdAt: '2026-04-27T00:00:00.000Z',
};

const prodProject: ProjectSummary = {
  ...project,
  id: 'prod',
  name: 'Production',
  projectId: 'prod',
  target: 'production',
};
