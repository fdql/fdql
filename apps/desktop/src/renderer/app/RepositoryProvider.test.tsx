import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRepositories } from './RepositoryProvider.tsx';

const snapshot: SettingsSnapshot = {
  activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
  sidebarWidth: 320,
  inspectorWidth: 360,
  theme: 'system',
  density: 'compact',
  dataMode: 'mock',
  hotkeyOverrides: {},
  resultTableLayouts: {},
  firestoreFieldCatalogs: {},
  firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
  updates: DEFAULT_UPDATE_SETTINGS,
  workspaceState: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRepositories', () => {
  it('uses desktop settings in mock data mode when the desktop API is available', async () => {
    const save = vi.fn(async () => ({ ...snapshot, dataMode: 'live' as const }));
    const onDataModeChange = vi.fn();
    stubDesktopApi({
      settings: {
        load: vi.fn(async () => snapshot),
        save,
        getHotkeyOverrides: vi.fn(async () => ({})),
        setHotkeyOverrides: vi.fn(async () => {}),
      },
    });

    const repositories = createRepositories({ dataMode: 'mock', onDataModeChange });
    await repositories.settings.save({ dataMode: 'live' });

    expect(save).toHaveBeenCalledWith({ dataMode: 'live' });
    expect(onDataModeChange).toHaveBeenCalledWith('live');
  });

  it('uses desktop activity in mock data mode when the desktop API is available', async () => {
    const listActivity = vi.fn(async () => []);
    const listJobs = vi.fn(async () => []);
    stubDesktopApi({
      activity: {
        append: vi.fn(),
        clear: vi.fn(),
        export: vi.fn(),
        list: listActivity,
      },
      jobs: {
        acknowledgeIssues: vi.fn(),
        cancel: vi.fn(),
        clearCompleted: vi.fn(),
        list: listJobs,
        pickExportFile: vi.fn(),
        pickImportFile: vi.fn(),
        start: vi.fn(),
        subscribe: vi.fn(() => () => {}),
      },
    });

    const repositories = createRepositories({ dataMode: 'mock' });
    await repositories.activity.list({ limit: 1 });
    await repositories.jobs.list({ limit: 1 });

    expect(listActivity).toHaveBeenCalledWith({ limit: 1 });
    expect(listJobs).toHaveBeenCalledWith({ limit: 1 });
  });

  it('does not fall back to mock feature repositories in live data mode', async () => {
    const listUsers = vi.fn(async () => ({ items: [], nextCursor: null }));
    const runScript = vi.fn(async () => ({
      returnValue: 1,
      logs: [],
      errors: [],
      durationMs: 1,
    }));
    stubDesktopApi({
      auth: {
        ...desktopAuthApi(),
        listUsers,
      },
      firestore: {
        ...desktopFirestoreApi(),
        listRootCollections: vi.fn(async () => []),
      },
      scriptRunner: {
        run: runScript,
        cancel: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
      },
      settings: {
        load: vi.fn(async () => ({ ...snapshot, dataMode: 'live' as const })),
        save: vi.fn(async () => ({ ...snapshot, dataMode: 'live' as const })),
        getHotkeyOverrides: vi.fn(async () => ({})),
        setHotkeyOverrides: vi.fn(async () => {}),
      },
    });

    const repositories = createRepositories({ dataMode: 'live' });

    await expect(repositories.auth.listUsers('demo-local')).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(listUsers).toHaveBeenCalledWith({ projectId: 'demo-local' });
    await expect(repositories.scriptRunner.run({
      runId: 'run-1',
      connectionId: 'emu',
      source: 'return 1;',
    }))
      .resolves.toMatchObject({ returnValue: 1 });
    expect(runScript).toHaveBeenCalledWith({
      runId: 'run-1',
      connectionId: 'emu',
      source: 'return 1;',
    });
  });

  it('rejects live data mode when the desktop live API is unavailable', async () => {
    const save = vi.fn(async () => ({ ...snapshot, dataMode: 'live' as const }));
    const onDataModeChange = vi.fn();
    vi.stubGlobal('firebaseDesk', {
      settings: {
        load: vi.fn(async () => snapshot),
        save,
        getHotkeyOverrides: vi.fn(async () => ({})),
        setHotkeyOverrides: vi.fn(async () => {}),
      },
    });

    const repositories = createRepositories({ dataMode: 'mock', onDataModeChange });

    await expect(repositories.settings.save({ dataMode: 'live' })).rejects.toThrow(
      'Live mode requires the Firebase Desk desktop app.',
    );
    expect(save).not.toHaveBeenCalled();
    expect(onDataModeChange).not.toHaveBeenCalled();
  });
});

function stubDesktopApi(overrides: Partial<DesktopApi>): void {
  vi.stubGlobal('firebaseDesk', {
    activity: desktopActivityApi(),
    auth: desktopAuthApi(),
    firestore: desktopFirestoreApi(),
    jobs: desktopJobsApi(),
    projects: desktopProjectsApi(),
    scriptRunner: desktopScriptRunnerApi(),
    settings: desktopSettingsApi(),
    ...overrides,
  });
}

function desktopActivityApi(): DesktopActivityApi {
  return {
    append: vi.fn(),
    clear: vi.fn(),
    export: vi.fn(),
    list: vi.fn(async () => []),
  };
}

function desktopAuthApi(): DesktopAuthApi {
  return {
    getUser: vi.fn(async () => null),
    listUsers: vi.fn(async () => ({ items: [], nextCursor: null })),
    searchUsers: vi.fn(async () => []),
    setCustomClaims: vi.fn(async () => authUser()),
  };
}

function desktopFirestoreApi(): DesktopFirestoreApi {
  return {
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    generateDocumentId: vi.fn(),
    getDocument: vi.fn(),
    listDocuments: vi.fn(),
    listRootCollections: vi.fn(async () => []),
    listSubcollections: vi.fn(),
    runQuery: vi.fn(),
    saveDocument: vi.fn(),
    updateDocumentFields: vi.fn(),
  };
}

function desktopJobsApi(): DesktopJobsApi {
  return {
    acknowledgeIssues: vi.fn(),
    cancel: vi.fn(),
    clearCompleted: vi.fn(),
    list: vi.fn(async () => []),
    pickExportFile: vi.fn(),
    pickImportFile: vi.fn(),
    start: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
}

function desktopProjectsApi(): DesktopProjectsApi {
  return {
    add: vi.fn(),
    get: vi.fn(),
    list: vi.fn(async () => []),
    pickServiceAccountFile: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    validateServiceAccount: vi.fn(),
  };
}

function desktopScriptRunnerApi(): DesktopScriptRunnerApi {
  return {
    cancel: vi.fn(async () => {}),
    run: vi.fn(async () => ({ returnValue: null, logs: [], errors: [], durationMs: 1 })),
    subscribe: vi.fn(() => () => {}),
  };
}

function desktopSettingsApi(): DesktopSettingsApi {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => snapshot),
    getHotkeyOverrides: vi.fn(async () => ({})),
    setHotkeyOverrides: vi.fn(async () => {}),
  };
}

function authUser(): Awaited<ReturnType<DesktopAuthApi['setCustomClaims']>> {
  return {
    customClaims: {},
    disabled: false,
    displayName: null,
    email: null,
    provider: 'password',
    uid: 'user-1',
  };
}
