/// <reference types="vite/client" />

import type { IpcRequest, IpcResponse } from '@firebase-desk/ipc-schemas';
import type { ScriptRunEventListener } from '@firebase-desk/repo-contracts';
import type { BackgroundJobEvent } from '@firebase-desk/repo-contracts/jobs';

declare global {
  interface DesktopAppApi {
    readonly checkForUpdates: (
      request: IpcRequest<'app.checkForUpdates'>,
    ) => Promise<IpcResponse<'app.checkForUpdates'>>;
    readonly getConfig: () => Promise<IpcResponse<'app.config'>>;
    readonly openExternalUrl: (
      request: IpcRequest<'app.openExternalUrl'>,
    ) => Promise<IpcResponse<'app.openExternalUrl'>>;
    readonly openDataDirectory: () => Promise<IpcResponse<'app.openDataDirectory'>>;
  }

  interface DesktopHealthApi {
    readonly check: (request: IpcRequest<'health.check'>) => Promise<IpcResponse<'health.check'>>;
  }

  interface DesktopActivityApi {
    readonly append: (
      request: IpcRequest<'activity.append'>,
    ) => Promise<IpcResponse<'activity.append'>>;
    readonly clear: () => Promise<IpcResponse<'activity.clear'>>;
    readonly export: (
      request: IpcRequest<'activity.export'>,
    ) => Promise<IpcResponse<'activity.export'>>;
    readonly list: (
      request: IpcRequest<'activity.list'>,
    ) => Promise<IpcResponse<'activity.list'>>;
  }

  interface DesktopJobsApi {
    readonly acknowledgeIssues: (
      request: IpcRequest<'jobs.acknowledgeIssues'>,
    ) => Promise<IpcResponse<'jobs.acknowledgeIssues'>>;
    readonly cancel: (request: IpcRequest<'jobs.cancel'>) => Promise<IpcResponse<'jobs.cancel'>>;
    readonly clearCompleted: () => Promise<IpcResponse<'jobs.clearCompleted'>>;
    readonly list: (request: IpcRequest<'jobs.list'>) => Promise<IpcResponse<'jobs.list'>>;
    readonly pickExportFile: (
      request: IpcRequest<'jobs.pickExportFile'>,
    ) => Promise<IpcResponse<'jobs.pickExportFile'>>;
    readonly pickImportFile: () => Promise<IpcResponse<'jobs.pickImportFile'>>;
    readonly start: (request: IpcRequest<'jobs.start'>) => Promise<IpcResponse<'jobs.start'>>;
    readonly subscribe: (listener: (event: BackgroundJobEvent) => void) => () => void;
  }

  interface DesktopProjectsApi {
    readonly list: () => Promise<IpcResponse<'projects.list'>>;
    readonly get: (request: IpcRequest<'projects.get'>) => Promise<IpcResponse<'projects.get'>>;
    readonly add: (request: IpcRequest<'projects.add'>) => Promise<IpcResponse<'projects.add'>>;
    readonly update: (
      request: IpcRequest<'projects.update'>,
    ) => Promise<IpcResponse<'projects.update'>>;
    readonly remove: (
      request: IpcRequest<'projects.remove'>,
    ) => Promise<IpcResponse<'projects.remove'>>;
    readonly validateServiceAccount: (
      request: IpcRequest<'projects.validateServiceAccount'>,
    ) => Promise<IpcResponse<'projects.validateServiceAccount'>>;
    readonly pickServiceAccountFile: () => Promise<IpcResponse<'projects.pickServiceAccountFile'>>;
  }

  interface DesktopSettingsApi {
    readonly load: () => Promise<IpcResponse<'settings.load'>>;
    readonly save: (request: IpcRequest<'settings.save'>) => Promise<IpcResponse<'settings.save'>>;
    readonly getHotkeyOverrides: () => Promise<IpcResponse<'settings.getHotkeyOverrides'>>;
    readonly setHotkeyOverrides: (
      request: IpcRequest<'settings.setHotkeyOverrides'>,
    ) => Promise<IpcResponse<'settings.setHotkeyOverrides'>>;
  }

  interface DesktopFirestoreApi {
    readonly listRootCollections: (
      request: IpcRequest<'firestore.listRootCollections'>,
    ) => Promise<IpcResponse<'firestore.listRootCollections'>>;
    readonly listDocuments: (
      request: IpcRequest<'firestore.listDocuments'>,
    ) => Promise<IpcResponse<'firestore.listDocuments'>>;
    readonly listSubcollections: (
      request: IpcRequest<'firestore.listSubcollections'>,
    ) => Promise<IpcResponse<'firestore.listSubcollections'>>;
    readonly runQuery: (
      request: IpcRequest<'firestore.runQuery'>,
    ) => Promise<IpcResponse<'firestore.runQuery'>>;
    readonly getDocument: (
      request: IpcRequest<'firestore.getDocument'>,
    ) => Promise<IpcResponse<'firestore.getDocument'>>;
    readonly generateDocumentId: (
      request: IpcRequest<'firestore.generateDocumentId'>,
    ) => Promise<IpcResponse<'firestore.generateDocumentId'>>;
    readonly createDocument: (
      request: IpcRequest<'firestore.createDocument'>,
    ) => Promise<IpcResponse<'firestore.createDocument'>>;
    readonly saveDocument: (
      request: IpcRequest<'firestore.saveDocument'>,
    ) => Promise<IpcResponse<'firestore.saveDocument'>>;
    readonly updateDocumentFields: (
      request: IpcRequest<'firestore.updateDocumentFields'>,
    ) => Promise<IpcResponse<'firestore.updateDocumentFields'>>;
    readonly deleteDocument: (
      request: IpcRequest<'firestore.deleteDocument'>,
    ) => Promise<IpcResponse<'firestore.deleteDocument'>>;
  }

  interface DesktopScriptRunnerApi {
    readonly run: (
      request: IpcRequest<'scriptRunner.run'>,
    ) => Promise<IpcResponse<'scriptRunner.run'>>;
    readonly cancel: (
      request: IpcRequest<'scriptRunner.cancel'>,
    ) => Promise<IpcResponse<'scriptRunner.cancel'>>;
    readonly subscribe: (listener: ScriptRunEventListener) => () => void;
  }

  interface DesktopAuthApi {
    readonly listUsers: (
      request: IpcRequest<'auth.listUsers'>,
    ) => Promise<IpcResponse<'auth.listUsers'>>;
    readonly getUser: (
      request: IpcRequest<'auth.getUser'>,
    ) => Promise<IpcResponse<'auth.getUser'>>;
    readonly searchUsers: (
      request: IpcRequest<'auth.searchUsers'>,
    ) => Promise<IpcResponse<'auth.searchUsers'>>;
    readonly setCustomClaims: (
      request: IpcRequest<'auth.setCustomClaims'>,
    ) => Promise<IpcResponse<'auth.setCustomClaims'>>;
  }

  interface DesktopApi {
    readonly app: DesktopAppApi;
    readonly activity: DesktopActivityApi;
    readonly health: DesktopHealthApi;
    readonly jobs: DesktopJobsApi;
    readonly projects: DesktopProjectsApi;
    readonly settings: DesktopSettingsApi;
    readonly firestore: DesktopFirestoreApi;
    readonly scriptRunner: DesktopScriptRunnerApi;
    readonly auth: DesktopAuthApi;
    readonly channels: ReadonlyArray<string>;
  }

  interface Window {
    readonly firebaseDesk: DesktopApi;
  }
}

export type { DesktopApi };
