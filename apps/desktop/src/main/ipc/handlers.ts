import type {
  ActivityLogRepository,
  AuthRepository,
  FdqlRepository,
  FirestoreRepository,
  FirestoreSqlRepository,
  PickServiceAccountFileResult,
  ProjectsRepository,
  ScriptRunnerRepository,
} from '@firebase-desk/repo-contracts';
import type { BackgroundJobRepository } from '@firebase-desk/repo-contracts/jobs';
import { createActivityHandlers } from './activity-handlers.ts';
import { type AppHandlerDeps, createAppHandlers } from './app-handlers.ts';
import { createAuthHandlers } from './auth-handlers.ts';
import { createFdqlHandlers } from './fdql-handlers.ts';
import { createFirestoreHandlers } from './firestore-handlers.ts';
import { createFirestoreSqlHandlers } from './firestore-sql-handlers.ts';
import type { IpcHandlerMap } from './handler-types.ts';
import { createJobsHandlers } from './jobs-handlers.ts';
import { createProjectsHandlers } from './projects-handlers.ts';
import { createScriptRunnerHandlers } from './script-runner-handlers.ts';
import { createSettingsHandlers } from './settings-handlers.ts';

export interface CreateIpcHandlersDeps extends AppHandlerDeps {
  readonly activityLogRepository: ActivityLogRepository & { readonly prune: () => Promise<void>; };
  readonly authProvider: {
    readonly invalidateConnection: (connectionId: string) => Promise<void>;
  };
  readonly authRepository: AuthRepository;
  readonly jobsRepository: BackgroundJobRepository;
  readonly firestoreProvider: {
    readonly invalidateConnection: (connectionId: string) => Promise<void>;
  };
  readonly firestoreRepository: FirestoreRepository & {
    readonly invalidateConnection: (connectionId: string) => void;
  };
  readonly fdqlRepository: Pick<FdqlRepository, 'cancel' | 'compile' | 'run'>;
  readonly firestoreSqlRepository: Pick<FirestoreSqlRepository, 'cancel' | 'compile' | 'run'>;
  readonly pickServiceAccountFile: () => Promise<PickServiceAccountFileResult>;
  readonly projectsRepository: ProjectsRepository & {
    readonly validateServiceAccount: NonNullable<ProjectsRepository['validateServiceAccount']>;
  };
  readonly scriptRunnerRepository: Pick<ScriptRunnerRepository, 'cancel' | 'run'>;
}

export function createIpcHandlers(deps: CreateIpcHandlersDeps): IpcHandlerMap {
  return {
    ...createAppHandlers(deps),
    ...createActivityHandlers(deps.activityLogRepository),
    ...createJobsHandlers(deps.jobsRepository),
    ...createProjectsHandlers({
      authProvider: deps.authProvider,
      firestoreProvider: deps.firestoreProvider,
      firestoreRepository: deps.firestoreRepository,
      pickServiceAccountFile: deps.pickServiceAccountFile,
      projectsRepository: deps.projectsRepository,
    }),
    ...createFirestoreHandlers(deps.firestoreRepository),
    ...createFdqlHandlers(deps.fdqlRepository),
    ...createFirestoreSqlHandlers(deps.firestoreSqlRepository),
    ...createScriptRunnerHandlers(deps.scriptRunnerRepository),
    ...createAuthHandlers(deps.authRepository),
    ...createSettingsHandlers(deps.settingsRepository, deps.activityLogRepository),
  };
}
