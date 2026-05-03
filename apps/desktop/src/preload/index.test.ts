import { JOB_EVENT_CHANNEL, SCRIPT_RUN_EVENT_CHANNEL } from '@firebase-desk/ipc-schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi } from './index.ts';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

describe('preload script runner api', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await import('./index.ts');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the desktop api when document is unavailable', async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('document', undefined);

    await import('./index.ts');

    expect(exposedApi().app.getConfig).toEqual(expect.any(Function));
  });

  it('subscribes and unsubscribes to script runner events', () => {
    const api = exposedApi();
    const listener = vi.fn();
    const unsubscribe = api.scriptRunner.subscribe(listener);
    const handler = electronMocks.on.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => void;

    handler({}, {
      type: 'log',
      runId: 'run-1',
      log: { level: 'info', message: 'ready', timestamp: '2026-04-28T00:00:00.000Z' },
    });
    unsubscribe();

    expect(electronMocks.on).toHaveBeenCalledWith(SCRIPT_RUN_EVENT_CHANNEL, handler);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', runId: 'run-1' }));
    expect(electronMocks.removeListener).toHaveBeenCalledWith(SCRIPT_RUN_EVENT_CHANNEL, handler);
  });

  it('ignores invalid script runner events', () => {
    const api = exposedApi();
    const listener = vi.fn();
    api.scriptRunner.subscribe(listener);
    const handler = electronMocks.on.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => void;

    expect(() => handler({}, { type: 'invalid', runId: 'run-1' })).not.toThrow();

    expect(listener).not.toHaveBeenCalled();
  });

  it('exposes Firestore write methods', async () => {
    const api = exposedApi();
    electronMocks.invoke
      .mockResolvedValueOnce({ documentId: 'generated_id' })
      .mockResolvedValueOnce({
        id: 'ord_1',
        path: 'orders/ord_1',
        data: { status: 'paid' },
        hasSubcollections: false,
        updateTime: '2026-04-29T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        status: 'saved',
        document: {
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { status: 'paid' },
          hasSubcollections: false,
          updateTime: '2026-04-29T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        status: 'saved',
        document: {
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { status: 'shipped' },
          hasSubcollections: false,
          updateTime: '2026-04-29T00:00:01.000Z',
        },
      })
      .mockResolvedValueOnce(undefined);

    await expect(api.firestore.generateDocumentId({
      connectionId: 'emu',
      collectionPath: 'orders',
    })).resolves.toEqual({ documentId: 'generated_id' });
    await expect(api.firestore.createDocument({
      connectionId: 'emu',
      collectionPath: 'orders',
      documentId: 'ord_1',
      data: { status: 'paid' },
    })).resolves.toMatchObject({ id: 'ord_1' });
    await expect(api.firestore.saveDocument({
      connectionId: 'emu',
      documentPath: 'orders/ord_1',
      data: { status: 'paid' },
      options: { lastUpdateTime: '2026-04-29T00:00:00.000Z' },
    })).resolves.toMatchObject({ status: 'saved', document: { id: 'ord_1' } });
    await expect(api.firestore.updateDocumentFields({
      connectionId: 'emu',
      documentPath: 'orders/ord_1',
      operations: [
        { baseValue: 'paid', fieldPath: ['status'], type: 'set', value: 'shipped' },
      ],
      options: {
        lastUpdateTime: '2026-04-29T00:00:00.000Z',
        staleBehavior: 'save-and-notify',
      },
    })).resolves.toMatchObject({ status: 'saved', document: { id: 'ord_1' } });
    await expect(api.firestore.deleteDocument({
      connectionId: 'emu',
      documentPath: 'orders/ord_1',
      options: { deleteSubcollectionPaths: ['orders/ord_1/events'] },
    })).resolves.toBeUndefined();

    expect(electronMocks.invoke).toHaveBeenCalledWith('firestore.generateDocumentId', {
      connectionId: 'emu',
      collectionPath: 'orders',
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith('firestore.createDocument', {
      connectionId: 'emu',
      collectionPath: 'orders',
      documentId: 'ord_1',
      data: { status: 'paid' },
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith('firestore.saveDocument', {
      connectionId: 'emu',
      documentPath: 'orders/ord_1',
      data: { status: 'paid' },
      options: { lastUpdateTime: '2026-04-29T00:00:00.000Z' },
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith('firestore.updateDocumentFields', {
      connectionId: 'emu',
      documentPath: 'orders/ord_1',
      operations: [
        { baseValue: 'paid', fieldPath: ['status'], type: 'set', value: 'shipped' },
      ],
      options: {
        lastUpdateTime: '2026-04-29T00:00:00.000Z',
        staleBehavior: 'save-and-notify',
      },
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith('firestore.deleteDocument', {
      connectionId: 'emu',
      documentPath: 'orders/ord_1',
      options: { deleteSubcollectionPaths: ['orders/ord_1/events'] },
    });
  });

  it('exposes jobs methods and subscriptions', async () => {
    const api = exposedApi();
    const listener = vi.fn();
    electronMocks.invoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        createdAt: '2026-04-29T00:00:00.000Z',
        id: 'job-1',
        progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
        request: {
          collectionPath: 'orders',
          connectionId: 'emu',
          includeSubcollections: false,
          type: 'firestore.deleteCollection',
        },
        status: 'queued',
        title: 'Delete collection',
        type: 'firestore.deleteCollection',
        updatedAt: '2026-04-29T00:00:00.000Z',
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ canceled: false, filePath: '/tmp/orders.jsonl' })
      .mockResolvedValueOnce({ canceled: false, filePath: '/tmp/import.jsonl' });

    const unsubscribe = api.jobs.subscribe(listener);
    const handler = electronMocks.on.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => void;
    handler({}, {
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
        updatedAt: '2026-04-29T00:00:01.000Z',
      },
      type: 'job-updated',
    });
    unsubscribe();

    await expect(api.jobs.list({ limit: 20 })).resolves.toEqual([]);
    await expect(api.jobs.acknowledgeIssues({ ids: ['job-1'] })).resolves.toBeUndefined();
    await expect(api.jobs.start({
      collectionPath: 'orders',
      connectionId: 'emu',
      includeSubcollections: false,
      type: 'firestore.deleteCollection',
    })).resolves.toMatchObject({ id: 'job-1' });
    await expect(api.jobs.cancel({ id: 'job-1' })).resolves.toBeUndefined();
    await expect(api.jobs.clearCompleted()).resolves.toBeUndefined();
    await expect(api.jobs.pickExportFile({ format: 'jsonl' })).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/orders.jsonl',
    });
    await expect(api.jobs.pickImportFile()).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/import.jsonl',
    });

    expect(electronMocks.on).toHaveBeenCalledWith(JOB_EVENT_CHANNEL, handler);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'job-updated' }));
    expect(electronMocks.removeListener).toHaveBeenCalledWith(JOB_EVENT_CHANNEL, handler);
    expect(electronMocks.invoke).toHaveBeenCalledWith('jobs.list', { limit: 20 });
    expect(electronMocks.invoke).toHaveBeenCalledWith('jobs.acknowledgeIssues', {
      ids: ['job-1'],
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith('jobs.cancel', { id: 'job-1' });
  });
});

function exposedApi(): DesktopApi {
  return electronMocks.exposeInMainWorld.mock.calls[0]?.[1] as DesktopApi;
}
