import type {
  ActivityLogRepository,
  AuthRepository,
  DataMode,
  FirestoreRepository,
  HotkeyOverrides,
  ProjectsRepository,
  ScriptRunnerRepository,
  SettingsPatch,
  SettingsRepository,
  SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import type { BackgroundJobRepository } from '@firebase-desk/repo-contracts/jobs';
import {
  MockActivityLogRepository,
  MockAuthRepository,
  MockFirestoreRepository,
  MockProjectsRepository,
  MockScriptRunnerRepository,
  MockSettingsRepository,
} from '@firebase-desk/repo-mocks';
import { MockBackgroundJobRepository } from '@firebase-desk/repo-mocks/jobs';
import { createContext, type ReactNode, useContext } from 'react';
import { IpcActivityLogRepository } from './repositories/ipc-activity-log-repository.ts';
import { IpcAuthRepository } from './repositories/ipc-auth-repository.ts';
import { IpcBackgroundJobRepository } from './repositories/ipc-background-job-repository.ts';
import { IpcFirestoreRepository } from './repositories/ipc-firestore-repository.ts';
import { IpcProjectsRepository } from './repositories/ipc-projects-repository.ts';
import { IpcScriptRunnerRepository } from './repositories/ipc-script-runner-repository.ts';
import { IpcSettingsRepository } from './repositories/ipc-settings-repository.ts';

export interface RepositorySet {
  readonly activity: ActivityLogRepository;
  readonly auth: AuthRepository;
  readonly firestore: FirestoreRepository;
  readonly jobs: BackgroundJobRepository;
  readonly projects: ProjectsRepository;
  readonly scriptRunner: ScriptRunnerRepository;
  readonly settings: SettingsRepository;
}

const RepositoryContext = createContext<RepositorySet | null>(null);

export interface RepositoryProviderProps {
  readonly children: ReactNode;
  readonly repositories: RepositorySet;
}

export interface CreateRepositoriesOptions {
  readonly dataMode: DataMode;
  readonly onDataModeChange?: (dataMode: DataMode) => void;
}

const LIVE_MODE_UNAVAILABLE_MESSAGE =
  'Live mode requires the Firebase Desk desktop app. Open the desktop app to use live Firebase data.';

const ACTIVITY_API_METHODS = ['append', 'clear', 'export', 'list'] as const;
const AUTH_API_METHODS = ['getUser', 'listUsers', 'searchUsers', 'setCustomClaims'] as const;
const FIRESTORE_API_METHODS = [
  'createDocument',
  'deleteDocument',
  'generateDocumentId',
  'getDocument',
  'listDocuments',
  'listRootCollections',
  'listSubcollections',
  'runQuery',
  'saveDocument',
  'updateDocumentFields',
] as const;
const JOBS_API_METHODS = [
  'acknowledgeIssues',
  'cancel',
  'clearCompleted',
  'list',
  'pickExportFile',
  'pickImportFile',
  'start',
  'subscribe',
] as const;
const PROJECTS_API_METHODS = [
  'add',
  'get',
  'list',
  'pickServiceAccountFile',
  'remove',
  'update',
  'validateServiceAccount',
] as const;
const SCRIPT_RUNNER_API_METHODS = ['cancel', 'run', 'subscribe'] as const;
const SETTINGS_API_METHODS = ['getHotkeyOverrides', 'load', 'save', 'setHotkeyOverrides'] as const;

export function createMockRepositories(): RepositorySet {
  return {
    activity: new MockActivityLogRepository(),
    auth: new MockAuthRepository(),
    firestore: new MockFirestoreRepository(),
    jobs: new MockBackgroundJobRepository(),
    projects: new MockProjectsRepository(),
    scriptRunner: new MockScriptRunnerRepository(),
    settings: new MockSettingsRepository(),
  };
}

export function createRepositories(
  { dataMode, onDataModeChange }: CreateRepositoriesOptions,
): RepositorySet {
  const liveApiAvailable = hasLiveDesktopApi();
  const settings = new LiveModeGuardSettingsRepository(
    hasDesktopSettingsApi() ? new IpcSettingsRepository() : new MockSettingsRepository(),
    () => liveApiAvailable,
  );
  const activity = hasDesktopActivityApi()
    ? new IpcActivityLogRepository()
    : new MockActivityLogRepository();
  const jobs = hasDesktopJobsApi()
    ? new IpcBackgroundJobRepository()
    : new MockBackgroundJobRepository();
  const repositories: RepositorySet = dataMode === 'live'
    ? {
      activity,
      auth: new IpcAuthRepository(),
      firestore: new IpcFirestoreRepository(),
      jobs,
      projects: new IpcProjectsRepository(),
      scriptRunner: new IpcScriptRunnerRepository(),
      settings,
    }
    : { ...createMockRepositories(), activity, jobs, settings };

  return {
    ...repositories,
    settings: onDataModeChange
      ? new DataModeNotifyingSettingsRepository(repositories.settings, onDataModeChange)
      : repositories.settings,
  };
}

export function RepositoryProvider({ children, repositories }: RepositoryProviderProps) {
  return <RepositoryContext.Provider value={repositories}>{children}</RepositoryContext.Provider>;
}

export function useRepositories(): RepositorySet {
  const value = useContext(RepositoryContext);
  if (!value) throw new Error('useRepositories must be used within RepositoryProvider');
  return value;
}

class DataModeNotifyingSettingsRepository implements SettingsRepository {
  constructor(
    private readonly delegate: SettingsRepository,
    private readonly onDataModeChange: (dataMode: DataMode) => void,
  ) {}

  async load(): Promise<SettingsSnapshot> {
    return await this.delegate.load();
  }

  async save(patch: SettingsPatch): Promise<SettingsSnapshot> {
    const snapshot = await this.delegate.save(patch);
    if (patch.dataMode && patch.dataMode !== snapshot.dataMode) {
      this.onDataModeChange(snapshot.dataMode);
    } else if (patch.dataMode) {
      this.onDataModeChange(patch.dataMode);
    }
    return snapshot;
  }

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return await this.delegate.getHotkeyOverrides();
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    await this.delegate.setHotkeyOverrides(overrides);
  }
}

class LiveModeGuardSettingsRepository implements SettingsRepository {
  constructor(
    private readonly delegate: SettingsRepository,
    private readonly liveApiAvailable: () => boolean,
  ) {}

  async load(): Promise<SettingsSnapshot> {
    return await this.delegate.load();
  }

  async save(patch: SettingsPatch): Promise<SettingsSnapshot> {
    if (patch.dataMode === 'live' && !this.liveApiAvailable()) {
      throw new Error(LIVE_MODE_UNAVAILABLE_MESSAGE);
    }
    return await this.delegate.save(patch);
  }

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return await this.delegate.getHotkeyOverrides();
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    await this.delegate.setHotkeyOverrides(overrides);
  }
}

function hasDesktopActivityApi(): boolean {
  return hasMethods(desktopApi()?.activity, ACTIVITY_API_METHODS);
}

function hasDesktopJobsApi(): boolean {
  return hasMethods(desktopApi()?.jobs, JOBS_API_METHODS);
}

function hasDesktopSettingsApi(): boolean {
  return hasMethods(desktopApi()?.settings, SETTINGS_API_METHODS);
}

function hasLiveDesktopApi(): boolean {
  const api = desktopApi();
  return hasDesktopSettingsApi()
    && hasMethods(api?.auth, AUTH_API_METHODS)
    && hasMethods(api?.firestore, FIRESTORE_API_METHODS)
    && hasMethods(api?.projects, PROJECTS_API_METHODS)
    && hasMethods(api?.scriptRunner, SCRIPT_RUNNER_API_METHODS);
}

function desktopApi(): Partial<DesktopApi> | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { readonly firebaseDesk?: Partial<DesktopApi>; }).firebaseDesk;
}

function hasMethods<TMethod extends string>(
  value: unknown,
  methods: ReadonlyArray<TMethod>,
): value is Record<TMethod, (...args: never[]) => unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return methods.every((method) => typeof record[method] === 'function');
}
