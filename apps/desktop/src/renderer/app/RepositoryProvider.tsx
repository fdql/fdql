import type {
  ActivityLogRepository,
  AuthRepository,
  DataMode,
  FdqlRepository,
  FirestoreRepository,
  FirestoreSqlRepository,
  HotkeyOverrides,
  ProjectsRepository,
  ScriptRunnerRepository,
  SettingsPatch,
  SettingsRepository,
  SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_DENSITY,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
} from '@firebase-desk/repo-contracts';
import type { BackgroundJobRepository } from '@firebase-desk/repo-contracts/jobs';
import {
  createMockFdqlRepository,
  MockActivityLogRepository,
  MockAuthRepository,
  MockFirestoreRepository,
  MockFirestoreSqlRepository,
  MockProjectsRepository,
  MockScriptRunnerRepository,
  MockSettingsRepository,
} from '@firebase-desk/repo-mocks';
import { MockBackgroundJobRepository } from '@firebase-desk/repo-mocks/jobs';
import { createContext, type ReactNode, useContext } from 'react';
import { IpcActivityLogRepository } from './repositories/ipc-activity-log-repository.ts';
import { IpcAuthRepository } from './repositories/ipc-auth-repository.ts';
import { IpcBackgroundJobRepository } from './repositories/ipc-background-job-repository.ts';
import { createIpcFdqlRepository } from './repositories/ipc-fdql-repository.ts';
import { IpcFirestoreRepository } from './repositories/ipc-firestore-repository.ts';
import { IpcFirestoreSqlRepository } from './repositories/ipc-firestore-sql-repository.ts';
import { IpcProjectsRepository } from './repositories/ipc-projects-repository.ts';
import { IpcScriptRunnerRepository } from './repositories/ipc-script-runner-repository.ts';
import { IpcSettingsRepository } from './repositories/ipc-settings-repository.ts';

export interface RepositorySet {
  readonly activity: ActivityLogRepository;
  readonly auth: AuthRepository;
  readonly fdql: FdqlRepository;
  readonly firestore: FirestoreRepository;
  readonly firestoreSql: FirestoreSqlRepository;
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
  readonly demoMode?: boolean | undefined;
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
const FDQL_API_METHODS = ['cancel', 'compile', 'run', 'subscribe'] as const;
const FIRESTORE_SQL_API_METHODS = ['cancel', 'compile', 'run', 'subscribe'] as const;
const SETTINGS_API_METHODS = ['getHotkeyOverrides', 'load', 'save', 'setHotkeyOverrides'] as const;

export function createMockRepositories(
  options: { readonly settings?: SettingsRepository | undefined; } = {},
): RepositorySet {
  return {
    activity: new MockActivityLogRepository(),
    auth: new MockAuthRepository(),
    fdql: createMockFdqlRepository(),
    firestore: new MockFirestoreRepository(),
    firestoreSql: new MockFirestoreSqlRepository(),
    jobs: new MockBackgroundJobRepository(),
    projects: new MockProjectsRepository(),
    scriptRunner: new MockScriptRunnerRepository(),
    settings: options.settings ?? new MockSettingsRepository(),
  };
}

export function createRepositories(
  { dataMode, demoMode = false, onDataModeChange }: CreateRepositoriesOptions,
): RepositorySet {
  const liveApiAvailable = !demoMode && hasLiveDesktopApi();
  const mockSettings = new MockSettingsRepository(
    demoMode ? createDemoSettingsSnapshot() : undefined,
  );
  const settings = new LiveModeGuardSettingsRepository(
    !demoMode && hasDesktopSettingsApi() ? new IpcSettingsRepository() : mockSettings,
    () => liveApiAvailable,
  );
  const activity = !demoMode && hasDesktopActivityApi()
    ? new IpcActivityLogRepository()
    : new MockActivityLogRepository();
  const jobs = dataMode === 'live' && !demoMode && hasDesktopJobsApi()
    ? new IpcBackgroundJobRepository()
    : new MockBackgroundJobRepository();
  const repositories: RepositorySet = dataMode === 'live'
    ? {
      activity,
      auth: new IpcAuthRepository(),
      fdql: createIpcFdqlRepository(),
      firestore: new IpcFirestoreRepository(),
      firestoreSql: new IpcFirestoreSqlRepository(),
      jobs,
      projects: new IpcProjectsRepository(),
      scriptRunner: new IpcScriptRunnerRepository(),
      settings,
    }
    : { ...createMockRepositories({ settings }), activity, settings };

  return {
    ...repositories,
    settings: onDataModeChange
      ? new DataModeNotifyingSettingsRepository(repositories.settings, onDataModeChange)
      : repositories.settings,
  };
}

function createDemoSettingsSnapshot(): SettingsSnapshot {
  return {
    activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
    sidebarWidth: 320,
    inspectorWidth: 360,
    theme: 'dark',
    density: DEFAULT_DENSITY,
    dataMode: 'mock',
    firstRunGuide: { completedAt: '2026-05-05T00:00:00.000Z' },
    hotkeyOverrides: {},
    resultTableLayouts: {},
    firestoreFieldCatalogs: {},
    firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
    updates: DEFAULT_UPDATE_SETTINGS,
    workspaceState: {
      version: 1,
      authFilter: '',
      drafts: {
        'tab-firestore-query-demo': {
          path: 'orders',
          filters: [],
          filterField: '',
          filterOp: '==',
          filterValue: '',
          sortField: '',
          sortDirection: 'desc',
          limit: 25,
        },
      },
      scripts: {
        'tab-js-query-demo':
          "const paidOrders = await db.collection('orders').where('status', '==', 'paid').get();\nyield paidOrders.docs[0];\nreturn paidOrders;",
      },
      sqlSources: {
        'tab-firestore-sql-demo':
          'select id(o) as orderId, o.status, o.total\nfrom orders o\nwhere o.status = "paid"\norder by o.total desc\nlimit 25',
      },
      tabsState: {
        activeTabId: 'tab-firestore-query-demo',
        interactionHistory: [{
          activeTabId: 'tab-firestore-query-demo',
          path: 'orders',
          selectedTreeItemId: 'collection:emu:orders',
        }],
        interactionHistoryIndex: 0,
        tabs: [
          {
            id: 'tab-firestore-query-demo',
            kind: 'firestore-query',
            title: 'orders',
            connectionId: 'emu',
            history: ['orders'],
            historyIndex: 0,
            inspectorWidth: 360,
          },
          {
            id: 'tab-auth-users-demo',
            kind: 'auth-users',
            title: 'Authentication',
            connectionId: 'emu',
            history: ['auth'],
            historyIndex: 0,
            inspectorWidth: 360,
          },
          {
            id: 'tab-js-query-demo',
            kind: 'js-query',
            title: 'JavaScript Query',
            connectionId: 'emu',
            history: ['scripts/default'],
            historyIndex: 0,
            inspectorWidth: 360,
          },
          {
            id: 'tab-firestore-sql-demo',
            kind: 'firestore-sql',
            title: 'Firestore SQL',
            connectionId: 'emu',
            history: ['sql/default'],
            historyIndex: 0,
            inspectorWidth: 360,
          },
        ],
      },
    },
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
    && hasMethods(api?.fdql, FDQL_API_METHODS)
    && hasMethods(api?.firestore, FIRESTORE_API_METHODS)
    && hasMethods(api?.firestoreSql, FIRESTORE_SQL_API_METHODS)
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
