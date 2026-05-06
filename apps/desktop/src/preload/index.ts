import {
  FDQL_EVENT_CHANNEL,
  FdqlRunEventSchema,
  FIRESTORE_SQL_EVENT_CHANNEL,
  FirestoreSqlRunEventSchema,
  IPC_CHANNELS,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  JOB_EVENT_CHANNEL,
  SCRIPT_RUN_EVENT_CHANNEL,
  ScriptRunEventSchema,
} from '@firebase-desk/ipc-schemas';
import { BackgroundJobEventSchema } from '@firebase-desk/ipc-schemas/jobs';
import type {
  FdqlRunEvent,
  FdqlRunEventListener,
  FirestoreSqlRunEvent,
  FirestoreSqlRunEventListener,
  ScriptRunEvent,
  ScriptRunEventListener,
} from '@firebase-desk/repo-contracts';
import type { BackgroundJobEvent } from '@firebase-desk/repo-contracts/jobs';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function invoke<C extends IpcChannel>(channel: C, request: IpcRequest<C>): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, request) as Promise<IpcResponse<C>>;
}

const api = {
  app: {
    checkForUpdates: (request: IpcRequest<'app.checkForUpdates'>) =>
      invoke('app.checkForUpdates', request),
    getConfig: () => invoke('app.config', {}),
    openExternalUrl: (request: IpcRequest<'app.openExternalUrl'>) =>
      invoke('app.openExternalUrl', request),
    openDataDirectory: () => invoke('app.openDataDirectory', {}),
  },
  health: {
    check: (request: IpcRequest<'health.check'>) => invoke('health.check', request),
  },
  activity: {
    append: (request: IpcRequest<'activity.append'>) => invoke('activity.append', request),
    clear: () => invoke('activity.clear', {}),
    export: (request: IpcRequest<'activity.export'>) => invoke('activity.export', request),
    list: (request: IpcRequest<'activity.list'>) => invoke('activity.list', request),
  },
  jobs: {
    acknowledgeIssues: (request: IpcRequest<'jobs.acknowledgeIssues'>) =>
      invoke('jobs.acknowledgeIssues', request),
    cancel: (request: IpcRequest<'jobs.cancel'>) => invoke('jobs.cancel', request),
    clearCompleted: () => invoke('jobs.clearCompleted', {}),
    list: (request: IpcRequest<'jobs.list'>) => invoke('jobs.list', request),
    pickExportFile: (request: IpcRequest<'jobs.pickExportFile'>) =>
      invoke('jobs.pickExportFile', request),
    pickImportFile: () => invoke('jobs.pickImportFile', {}),
    start: (request: IpcRequest<'jobs.start'>) => invoke('jobs.start', request),
    subscribe: (listener: (event: BackgroundJobEvent) => void) => {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = BackgroundJobEventSchema.safeParse(raw);
        if (!parsed.success) return;
        listener(parsed.data as BackgroundJobEvent);
      };
      ipcRenderer.on(JOB_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(JOB_EVENT_CHANNEL, handler);
    },
  },
  projects: {
    list: () => invoke('projects.list', {}),
    get: (request: IpcRequest<'projects.get'>) => invoke('projects.get', request),
    add: (request: IpcRequest<'projects.add'>) => invoke('projects.add', request),
    update: (request: IpcRequest<'projects.update'>) => invoke('projects.update', request),
    remove: (request: IpcRequest<'projects.remove'>) => invoke('projects.remove', request),
    validateServiceAccount: (request: IpcRequest<'projects.validateServiceAccount'>) =>
      invoke('projects.validateServiceAccount', request),
    pickServiceAccountFile: () => invoke('projects.pickServiceAccountFile', {}),
  },
  settings: {
    load: () => invoke('settings.load', {}),
    save: (request: IpcRequest<'settings.save'>) => invoke('settings.save', request),
    getHotkeyOverrides: () => invoke('settings.getHotkeyOverrides', {}),
    setHotkeyOverrides: (request: IpcRequest<'settings.setHotkeyOverrides'>) =>
      invoke('settings.setHotkeyOverrides', request),
  },
  firestore: {
    listRootCollections: (request: IpcRequest<'firestore.listRootCollections'>) =>
      invoke('firestore.listRootCollections', request),
    listDocuments: (request: IpcRequest<'firestore.listDocuments'>) =>
      invoke('firestore.listDocuments', request),
    listSubcollections: (request: IpcRequest<'firestore.listSubcollections'>) =>
      invoke('firestore.listSubcollections', request),
    runQuery: (request: IpcRequest<'firestore.runQuery'>) => invoke('firestore.runQuery', request),
    getDocument: (request: IpcRequest<'firestore.getDocument'>) =>
      invoke('firestore.getDocument', request),
    generateDocumentId: (request: IpcRequest<'firestore.generateDocumentId'>) =>
      invoke('firestore.generateDocumentId', request),
    createDocument: (request: IpcRequest<'firestore.createDocument'>) =>
      invoke('firestore.createDocument', request),
    saveDocument: (request: IpcRequest<'firestore.saveDocument'>) =>
      invoke('firestore.saveDocument', request),
    updateDocumentFields: (request: IpcRequest<'firestore.updateDocumentFields'>) =>
      invoke('firestore.updateDocumentFields', request),
    deleteDocument: (request: IpcRequest<'firestore.deleteDocument'>) =>
      invoke('firestore.deleteDocument', request),
  },
  fdql: {
    compile: (request: IpcRequest<'fdql.compile'>) => invoke('fdql.compile', request),
    run: (request: IpcRequest<'fdql.run'>) => invoke('fdql.run', request),
    cancel: (request: IpcRequest<'fdql.cancel'>) => invoke('fdql.cancel', request),
    subscribe: (listener: FdqlRunEventListener) => {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = FdqlRunEventSchema.safeParse(raw);
        if (!parsed.success) return;
        listener(parsed.data as FdqlRunEvent);
      };
      ipcRenderer.on(FDQL_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(FDQL_EVENT_CHANNEL, handler);
    },
  },
  firestoreSql: {
    compile: (request: IpcRequest<'firestoreSql.compile'>) =>
      invoke('firestoreSql.compile', request),
    run: (request: IpcRequest<'firestoreSql.run'>) => invoke('firestoreSql.run', request),
    cancel: (request: IpcRequest<'firestoreSql.cancel'>) => invoke('firestoreSql.cancel', request),
    subscribe: (listener: FirestoreSqlRunEventListener) => {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = FirestoreSqlRunEventSchema.safeParse(raw);
        if (!parsed.success) return;
        listener(parsed.data as FirestoreSqlRunEvent);
      };
      ipcRenderer.on(FIRESTORE_SQL_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(FIRESTORE_SQL_EVENT_CHANNEL, handler);
    },
  },
  scriptRunner: {
    run: (request: IpcRequest<'scriptRunner.run'>) => invoke('scriptRunner.run', request),
    cancel: (request: IpcRequest<'scriptRunner.cancel'>) => invoke('scriptRunner.cancel', request),
    subscribe: (listener: ScriptRunEventListener) => {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = ScriptRunEventSchema.safeParse(raw);
        if (!parsed.success) return;
        listener(parsed.data as ScriptRunEvent);
      };
      ipcRenderer.on(SCRIPT_RUN_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(SCRIPT_RUN_EVENT_CHANNEL, handler);
    },
  },
  auth: {
    listUsers: (request: IpcRequest<'auth.listUsers'>) => invoke('auth.listUsers', request),
    getUser: (request: IpcRequest<'auth.getUser'>) => invoke('auth.getUser', request),
    searchUsers: (request: IpcRequest<'auth.searchUsers'>) => invoke('auth.searchUsers', request),
    setCustomClaims: (request: IpcRequest<'auth.setCustomClaims'>) =>
      invoke('auth.setCustomClaims', request),
  },
  channels: Object.keys(IPC_CHANNELS) as IpcChannel[],
} as const;

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('firebaseDesk', api);
installPlatformDataset();

function installPlatformDataset(): void {
  setPlatformDataset();
  if (globalThis.document?.readyState === 'loading') {
    globalThis.window?.addEventListener('DOMContentLoaded', setPlatformDataset, { once: true });
  }
}

function setPlatformDataset(): void {
  const platform = globalThis.process?.platform;
  const root = globalThis.document?.documentElement;
  if (typeof platform !== 'string' || !root) return;
  root.dataset.platform = platform;
}
