import {
  IPC_CHANNELS,
  type IpcChannel,
  JOB_EVENT_CHANNEL,
  SCRIPT_RUN_EVENT_CHANNEL,
} from '@firebase-desk/ipc-schemas';
import { describe, expect, it, vi } from 'vitest';
import type { CreateIpcHandlersDeps } from './handlers.ts';
import { createIpcHandlers } from './handlers.ts';
import {
  broadcastBackgroundJobEvent,
  broadcastScriptRunEvent,
  registerIpcHandlers,
} from './registry.ts';

const electronMocks = vi.hoisted(() => ({
  getFocusedWindow: vi.fn(() => null),
  getAllWindows: vi.fn(),
  handle: vi.fn(),
  notificationIsSupported: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/firebase-desk-test'), getVersion: vi.fn(() => '0.0.0') },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    getFocusedWindow: electronMocks.getFocusedWindow,
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: electronMocks.handle },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { themeSource: 'system' },
  Notification: { isSupported: electronMocks.notificationIsSupported },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

describe('IPC handler registry', () => {
  it('creates a handler for every IPC channel', () => {
    expect(sortedKeys(Object.keys(createIpcHandlers(fakeDeps())))).toEqual(
      sortedKeys(Object.keys(IPC_CHANNELS)),
    );
  });

  it('registers every channel and validates request/response schemas', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const registered = new Map<IpcChannel, (event: unknown, raw: unknown) => Promise<unknown>>();
    electronMocks.handle.mockImplementation((channel, handler) => {
      registered.set(channel, handler);
    });

    registerIpcHandlers();

    expect(sortedKeys(registered.keys())).toEqual(sortedKeys(Object.keys(IPC_CHANNELS)));
    await expect(registered.get('projects.get')?.({}, {})).rejects.toThrow();
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[ipc] projects.get failed'));
    await expect(
      registered.get('health.check')?.({}, { ping: 'ping', sentAt: '2026-04-30T00:00:00.000Z' }),
    )
      .resolves.toMatchObject({
        appVersion: '0.0.0',
        pong: 'pong',
      });
    await expect(registered.get('app.config')?.({}, {})).resolves.toMatchObject({
      appVersion: '0.0.0',
      dataDirectory: '/tmp/firebase-desk-test',
    });
    stderrWrite.mockRestore();
  });
});

describe('script runner IPC event broadcast', () => {
  it('sends live script events to renderer windows', () => {
    const send = vi.fn();
    electronMocks.getAllWindows.mockReturnValue([{ webContents: { send } }]);

    broadcastScriptRunEvent({
      type: 'output',
      runId: 'run-1',
      item: {
        id: 'yield-1',
        label: 'yield 1',
        badge: 'number',
        view: 'json',
        value: 1,
      },
    });

    expect(send).toHaveBeenCalledWith(
      SCRIPT_RUN_EVENT_CHANNEL,
      expect.objectContaining({ type: 'output', runId: 'run-1' }),
    );
  });
});

describe('background job IPC event broadcast', () => {
  it('sends live job events to renderer windows', () => {
    const send = vi.fn();
    electronMocks.getAllWindows.mockReturnValue([{ webContents: { send } }]);

    broadcastBackgroundJobEvent({
      job: {
        createdAt: '2026-04-29T00:00:00.000Z',
        id: 'job-1',
        progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
        request: {
          collectionPath: 'orders',
          connectionId: 'emu',
          includeSubcollections: false,
          type: 'firestore.deleteCollection',
        },
        status: 'running',
        title: 'Delete collection',
        type: 'firestore.deleteCollection',
        updatedAt: '2026-04-29T00:00:00.000Z',
      },
      type: 'job-updated',
    });

    expect(send).toHaveBeenCalledWith(
      JOB_EVENT_CHANNEL,
      expect.objectContaining({ type: 'job-updated' }),
    );
  });
});

function sortedKeys(keys: Iterable<string>): string[] {
  const sorted = [...keys];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index] ?? '';
    let insertionIndex = index - 1;
    while (insertionIndex >= 0 && (sorted[insertionIndex] ?? '') > current) {
      sorted[insertionIndex + 1] = sorted[insertionIndex] ?? '';
      insertionIndex -= 1;
    }
    sorted[insertionIndex + 1] = current;
  }
  return sorted;
}

function fakeDeps(): CreateIpcHandlersDeps {
  return {
    activityLogRepository: {
      append: vi.fn(),
      clear: vi.fn(),
      export: vi.fn(),
      list: vi.fn(),
      prune: vi.fn(),
    },
    appVersion: '0.0.0',
    authProvider: { invalidateConnection: vi.fn() },
    authRepository: {
      getUser: vi.fn(),
      listUsers: vi.fn(),
      searchUsers: vi.fn(),
      setCustomClaims: vi.fn(),
    },
    dataDirectory: '/tmp/firebase-desk-test',
    firestoreProvider: { invalidateConnection: vi.fn() },
    firestoreRepository: {
      createDocument: vi.fn(),
      deleteDocument: vi.fn(),
      generateDocumentId: vi.fn(),
      getDocument: vi.fn(),
      invalidateConnection: vi.fn(),
      listDocuments: vi.fn(),
      listRootCollections: vi.fn(),
      listSubcollections: vi.fn(),
      runQuery: vi.fn(),
      saveDocument: vi.fn(),
      updateDocumentFields: vi.fn(),
    },
    jobsRepository: {
      acknowledgeIssues: vi.fn(),
      cancel: vi.fn(),
      clearCompleted: vi.fn(),
      list: vi.fn(),
      pickExportFile: vi.fn(),
      pickImportFile: vi.fn(),
      start: vi.fn(),
      subscribe: vi.fn(),
    },
    openDataDirectory: vi.fn(),
    pickServiceAccountFile: vi.fn(),
    projectsRepository: {
      add: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      pickServiceAccountFile: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      validateServiceAccount: vi.fn(),
    },
    scriptRunnerRepository: {
      cancel: vi.fn(),
      run: vi.fn(),
    },
    settingsRepository: {
      getHotkeyOverrides: vi.fn(),
      load: vi.fn(),
      save: vi.fn(),
      setHotkeyOverrides: vi.fn(),
    },
  } as unknown as CreateIpcHandlersDeps;
}
