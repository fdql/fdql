import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { type App, cert, deleteApp, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { type Firestore, initializeFirestore, type Settings } from 'firebase-admin/firestore';

export interface FirebaseConnectionConfig {
  readonly credentialJson?: string | null;
  readonly project: ProjectSummary;
}

export interface FirebaseConnectionResolver {
  resolveConnection(connectionId: string): Promise<FirebaseConnectionConfig>;
}

interface CachedFirestore {
  readonly app: App;
  readonly cacheKey: string;
  readonly db: Firestore;
}

export interface AdminFirestoreConnection {
  readonly config: FirebaseConnectionConfig;
  readonly db: Firestore;
}

const EMULATOR_RPC_TIMEOUT_MS = 5_000;
const EMULATOR_READ_METHODS = ['GetDocument', 'ListDocuments', 'ListCollectionIds', 'RunQuery'];

export class AdminFirestoreProvider {
  private readonly cache = new Map<string, CachedFirestore>();
  private readonly resolver: FirebaseConnectionResolver;

  constructor(resolver: FirebaseConnectionResolver) {
    this.resolver = resolver;
  }

  async getFirestore(connectionId: string, databaseId?: string | undefined): Promise<Firestore> {
    const config = await this.resolver.resolveConnection(connectionId);
    return this.getFirestoreForConfig(connectionId, config, databaseId);
  }

  async getFirestoreConnection(
    connectionId: string,
    databaseId?: string | undefined,
  ): Promise<AdminFirestoreConnection> {
    const config = await this.resolver.resolveConnection(connectionId);
    return { config, db: await this.getFirestoreForConfig(connectionId, config, databaseId) };
  }

  private async getFirestoreForConfig(
    connectionId: string,
    config: FirebaseConnectionConfig,
    databaseId?: string | undefined,
  ): Promise<Firestore> {
    const cacheSlot = cacheSlotFor(connectionId, databaseId);
    const cacheKey = cacheKeyFor(config, databaseId);
    const cached = this.cache.get(cacheSlot);
    if (cached?.cacheKey === cacheKey) return cached.db;
    if (cached) await this.deleteCached(cached);

    const app = initializeApp(appOptionsFor(config), appNameFor(connectionId, cacheKey));
    const db = withFirestoreEmulatorHost(
      config,
      () =>
        databaseId
          ? initializeFirestore(app, firestoreSettingsFor(config), databaseId)
          : initializeFirestore(app, firestoreSettingsFor(config)),
    );
    this.cache.set(cacheSlot, { app, cacheKey, db });
    return db;
  }

  async invalidateConnection(connectionId: string): Promise<void> {
    const entries = [...this.cache.entries()].filter(([key]) => key.startsWith(`${connectionId}:`));
    for (const [key] of entries) {
      this.cache.delete(key);
    }
    await Promise.all(entries.map(([, cached]) => this.deleteCached(cached)));
  }

  async clear(): Promise<void> {
    const cached = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(cached.map((entry) => this.deleteCached(entry)));
  }

  private async deleteCached(cached: CachedFirestore): Promise<void> {
    try {
      await cached.db.terminate();
    } finally {
      await deleteApp(cached.app);
    }
  }
}

function appOptionsFor(config: FirebaseConnectionConfig) {
  if (config.project.target === 'emulator') return { projectId: config.project.projectId };
  if (!config.credentialJson) {
    throw new Error(`Service account JSON is required for ${config.project.name}.`);
  }
  return {
    credential: cert(serviceAccountFromJson(config.credentialJson)),
    projectId: config.project.projectId,
  };
}

export function firestoreSettingsFor(config: FirebaseConnectionConfig): Settings {
  const base = { ignoreUndefinedProperties: true, projectId: config.project.projectId };
  if (config.project.target === 'emulator') {
    if (!config.project.emulator?.firestoreHost) {
      throw new Error(`Firestore emulator host is required for ${config.project.name}.`);
    }
    return {
      ...base,
      clientConfig: emulatorClientConfig(),
    };
  }
  return { ...base, preferRest: true };
}

function emulatorClientConfig() {
  return {
    interfaces: {
      'google.firestore.v1.Firestore': {
        methods: Object.fromEntries(
          EMULATOR_READ_METHODS.map((method) => [method, {
            timeout_millis: EMULATOR_RPC_TIMEOUT_MS,
          }]),
        ),
        retry_params: {
          default: {
            initial_retry_delay_millis: 100,
            initial_rpc_timeout_millis: EMULATOR_RPC_TIMEOUT_MS,
            max_retry_delay_millis: 1_000,
            max_rpc_timeout_millis: EMULATOR_RPC_TIMEOUT_MS,
            retry_delay_multiplier: 1.3,
            rpc_timeout_multiplier: 1,
            total_timeout_millis: EMULATOR_RPC_TIMEOUT_MS,
          },
        },
      },
    },
  };
}

function withFirestoreEmulatorHost<T>(
  config: FirebaseConnectionConfig,
  createFirestore: () => T,
): T {
  const previousHost = process.env['FIRESTORE_EMULATOR_HOST'];
  if (config.project.target === 'emulator') {
    process.env['FIRESTORE_EMULATOR_HOST'] = config.project.emulator?.firestoreHost ?? '';
  } else {
    delete process.env['FIRESTORE_EMULATOR_HOST'];
  }

  try {
    return createFirestore();
  } finally {
    if (previousHost === undefined) delete process.env['FIRESTORE_EMULATOR_HOST'];
    else process.env['FIRESTORE_EMULATOR_HOST'] = previousHost;
  }
}

function serviceAccountFromJson(json: string): ServiceAccount {
  const value = JSON.parse(json) as Record<string, unknown>;
  return {
    clientEmail: stringField(value, 'client_email'),
    privateKey: stringField(value, 'private_key'),
    projectId: stringField(value, 'project_id'),
  };
}

function stringField(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error(`Service account field ${field} is required.`);
  }
  return result;
}

function cacheKeyFor(
  { project, credentialJson }: FirebaseConnectionConfig,
  databaseId?: string,
): string {
  return JSON.stringify({
    credential: Boolean(credentialJson),
    databaseId: databaseId ?? null,
    emulatorHost: project.emulator?.firestoreHost ?? null,
    projectId: project.projectId,
    target: project.target,
  });
}

function cacheSlotFor(connectionId: string, databaseId?: string): string {
  return `${connectionId}:${databaseId ?? '(default)'}`;
}

function appNameFor(connectionId: string, cacheKey: string): string {
  const suffix = Math.abs(hash(cacheKey)).toString(36);
  return `firebase-desk-${safeName(connectionId)}-${suffix}`;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'connection';
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (Math.imul(31, result) + value.charCodeAt(index)) | 0;
  }
  return result;
}
