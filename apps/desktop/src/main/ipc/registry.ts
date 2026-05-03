import {
  IPC_CHANNELS,
  type IpcChannel,
  JOB_EVENT_CHANNEL,
  SCRIPT_RUN_EVENT_CHANNEL,
} from '@firebase-desk/ipc-schemas';
import type { ScriptRunEvent } from '@firebase-desk/repo-contracts';
import type { BackgroundJobEvent } from '@firebase-desk/repo-contracts/jobs';
import {
  AdminAuthProvider,
  AdminFirestoreProvider,
  FirebaseAuthRepository,
  type FirebaseConnectionResolver,
  FirebaseFirestoreRepository,
} from '@firebase-desk/repo-firebase';
import { ProcessScriptRunnerRepository } from '@firebase-desk/script-runner';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MainActivityLogRepository } from '../activity/main-activity-log-repository.ts';
import { MainBackgroundJobRepository } from '../jobs/background-job-repository.ts';
import { FirestoreCollectionJobRunner } from '../jobs/firestore-collection-job-runner.ts';
import { createBackgroundJobNotifier } from '../native-app.ts';
import { MainProjectsRepository } from '../projects/main-projects-repository.ts';
import { MainSettingsRepository } from '../settings/main-settings-repository.ts';
import { ActivityLogStore } from '../storage/activity-log-store.ts';
import { CredentialsStore } from '../storage/credentials-store.ts';
import { JobsStore } from '../storage/jobs-store.ts';
import { ProjectsStore } from '../storage/projects-store.ts';
import { SettingsStore } from '../storage/settings-store.ts';
import { toIpcScriptRunEvent } from './converters.ts';
import type { Handler } from './handler-types.ts';
import { createIpcHandlers } from './handlers.ts';

interface IpcLogger {
  error(message: string, error: unknown): void;
}

const ipcLogger: IpcLogger = {
  error(message, error) {
    process.stderr.write(`${message}\n${errorText(error)}\n`);
  },
};

export function registerIpcHandlers(): void {
  const userDataPath = app.getPath('userData');
  const settingsRepository = new MainSettingsRepository(new SettingsStore(userDataPath));
  const activityLogRepository = new MainActivityLogRepository(
    new ActivityLogStore(userDataPath),
    settingsRepository,
    {
      showSaveDialog: () =>
        process.env['FIREBASE_DESK_ACTIVITY_EXPORT_PATH']
          ? Promise.resolve({
            canceled: false,
            filePath: process.env['FIREBASE_DESK_ACTIVITY_EXPORT_PATH'],
          })
          : dialog.showSaveDialog({
            defaultPath: 'firebase-desk-activity.jsonl',
            filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
            title: 'Export activity',
          }),
    },
  );
  const projectsStore = new ProjectsStore(userDataPath);
  const credentialsStore = new CredentialsStore(userDataPath);
  const projectsRepository = new MainProjectsRepository(projectsStore, credentialsStore);
  const connectionResolver: FirebaseConnectionResolver = {
    async resolveConnection(connectionId) {
      const project = await projectsRepository.get(connectionId);
      if (!project) throw new Error(`Connection not found: ${connectionId}`);
      return {
        project,
        credentialJson: project.hasCredential ? await credentialsStore.load(project.id) : null,
      };
    },
  };
  const firestoreProvider = new AdminFirestoreProvider(connectionResolver);
  const firestoreRepository = new FirebaseFirestoreRepository(firestoreProvider);
  const jobsRepository = new MainBackgroundJobRepository(
    new JobsStore(userDataPath),
    new FirestoreCollectionJobRunner(firestoreProvider, {
      tempDirectory: resolve(userDataPath, 'tmp'),
    }),
    activityLogRepository,
  );
  const notifyBackgroundJob = createBackgroundJobNotifier();
  jobsRepository.subscribe((event) => {
    broadcastBackgroundJobEvent(event);
    notifyBackgroundJob(event);
  });
  void jobsRepository.initialize();
  const authProvider = new AdminAuthProvider(connectionResolver);
  const scriptRunnerRepository = new ProcessScriptRunnerRepository(connectionResolver, {
    workerPath: scriptRunnerWorkerPath(),
  });
  scriptRunnerRepository.subscribe(broadcastScriptRunEvent);
  const authRepository = new FirebaseAuthRepository(authProvider);

  const handlers = createIpcHandlers({
    activityLogRepository,
    appVersion: app.getVersion(),
    authProvider,
    authRepository,
    dataDirectory: userDataPath,
    firestoreProvider,
    firestoreRepository,
    jobsRepository,
    openDataDirectory: () => shell.openPath(userDataPath),
    pickServiceAccountFile: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select service account JSON',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      return { canceled: false, json: await readFile(result.filePaths[0], 'utf8') };
    },
    projectsRepository,
    scriptRunnerRepository,
    settingsRepository,
  });

  for (const channel of Object.keys(IPC_CHANNELS) as IpcChannel[]) {
    const handler = handlers[channel];
    const schema = IPC_CHANNELS[channel];
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      try {
        const parsed = schema.request.parse(raw);
        const result = await (handler as Handler<typeof channel>)(parsed as never);
        return schema.response.parse(result);
      } catch (error) {
        ipcLogger.error(`[ipc] ${channel} failed`, error);
        throw error;
      }
    });
  }
}

function scriptRunnerWorkerPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    resolve(currentDir, 'script-runner-worker.js'),
    resolve(currentDir, '..', 'script-runner-worker.js'),
    resolve(currentDir, '../script-runner-worker.ts'),
  ];
  const workerPath = candidatePaths.find((path) => existsSync(path));
  if (workerPath) return workerPath;
  throw new Error(`Unable to locate script runner worker. Checked ${candidatePaths.join(', ')}.`);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export function broadcastScriptRunEvent(event: ScriptRunEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SCRIPT_RUN_EVENT_CHANNEL, toIpcScriptRunEvent(event));
  }
}

export function broadcastBackgroundJobEvent(event: BackgroundJobEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(JOB_EVENT_CHANNEL, event);
  }
}
