import type {
  FdqlPersistentCache,
  FdqlPersistentCacheClearRequest,
  FdqlPersistentCacheHit,
  FdqlPersistentCacheSetResult,
  FdqlProviderRow,
} from '@firebase-desk/fdql';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const defaultMaxBytes = 256 * 1024 * 1024;

export interface FdqlPersistentCacheStoreOptions {
  readonly maxBytes?: number | undefined;
}

export interface FdqlPersistentCacheStore {
  readonly clear: NonNullable<FdqlPersistentCache['clear']>;
  readonly close: () => void;
  readonly get: FdqlPersistentCache['get'];
  readonly set: FdqlPersistentCache['set'];
}

export function createFdqlPersistentCacheStore(
  userDataPath: string,
  options: FdqlPersistentCacheStoreOptions = {},
): FdqlPersistentCacheStore {
  const filePath = join(userDataPath, 'fdql-cache.sqlite');
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  initialize(db);

  return {
    async clear(request) {
      return clearEntries(db, request);
    },

    async get(request): Promise<FdqlPersistentCacheHit | null> {
      const keyHash = hashKey(request.key.canonicalJson);
      const row = db.prepare(
        `select expires_at_ms, rows_json, size_bytes
         from fdql_lookup_cache
         where key_hash = ?`,
      ).get(keyHash) as CacheRow | undefined;
      if (!row) return null;
      if (row.expires_at_ms <= request.nowMs) {
        db.prepare('delete from fdql_lookup_cache where key_hash = ?').run(keyHash);
        return null;
      }
      db.prepare(
        `update fdql_lookup_cache
         set last_accessed_at_ms = ?
         where key_hash = ?`,
      ).run(request.nowMs, keyHash);
      return {
        rows: JSON.parse(row.rows_json) as readonly FdqlProviderRow[],
        sizeBytes: row.size_bytes,
      };
    },

    async set(request): Promise<FdqlPersistentCacheSetResult> {
      const keyHash = hashKey(request.key.canonicalJson);
      const rowsJson = JSON.stringify(request.rows);
      const sizeBytes = byteLength(request.key.canonicalJson) + byteLength(rowsJson);
      const metadata = cacheKeyMetadata(request.key.key);
      db.prepare(
        `insert or replace into fdql_lookup_cache (
          key_hash,
          key_json,
          provider,
          profile,
          project_id,
          created_at_ms,
          expires_at_ms,
          last_accessed_at_ms,
          size_bytes,
          rows_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        keyHash,
        request.key.canonicalJson,
        metadata.provider,
        metadata.profile,
        metadata.projectId,
        request.nowMs,
        request.expiresAtMs,
        request.nowMs,
        sizeBytes,
        rowsJson,
      );
      const evictedEntries = evictCache(db, request.nowMs, maxBytes);
      return { evictedEntries, sizeBytes };
    },

    close(): void {
      db.close();
    },
  };
}

function initialize(db: DatabaseSync): void {
  db.exec(`
    create table if not exists fdql_lookup_cache (
      key_hash text primary key,
      key_json text not null,
      provider text not null,
      profile text,
      project_id text,
      created_at_ms integer not null,
      expires_at_ms integer not null,
      last_accessed_at_ms integer not null,
      size_bytes integer not null,
      rows_json text not null
    );
    create index if not exists fdql_lookup_cache_provider_idx
      on fdql_lookup_cache(provider, project_id);
    create index if not exists fdql_lookup_cache_lru_idx
      on fdql_lookup_cache(last_accessed_at_ms);
    create index if not exists fdql_lookup_cache_expires_idx
      on fdql_lookup_cache(expires_at_ms);
  `);
}

function hashKey(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson).digest('hex');
}

function clearEntries(
  db: DatabaseSync,
  request: FdqlPersistentCacheClearRequest,
): { readonly clearedEntries: number; } {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (request.provider) {
    clauses.push('provider = @provider');
    params['provider'] = request.provider;
  }
  if (request.projectId) {
    clauses.push('project_id = @projectId');
    params['projectId'] = request.projectId;
  }
  if (request.profile) {
    clauses.push('profile = @profile');
    params['profile'] = request.profile;
  }
  const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';
  const result = db.prepare(`delete from fdql_lookup_cache${where}`).run(params) as {
    readonly changes?: number;
  };
  return { clearedEntries: result.changes ?? 0 };
}

function evictCache(db: DatabaseSync, nowMs: number, maxBytes: number): number {
  const expired = db.prepare(
    `delete from fdql_lookup_cache
     where expires_at_ms <= ?
     returning 1 as count`,
  ).all(nowMs).length;
  let evicted = expired;
  let totalBytes = cacheSizeBytes(db);
  while (totalBytes > maxBytes) {
    const victims = db.prepare(
      `select key_hash, size_bytes
       from fdql_lookup_cache
       order by last_accessed_at_ms asc
       limit 50`,
    ).all() as unknown as readonly CacheVictimRow[];
    if (!victims.length) break;
    for (const victim of victims) {
      db.prepare('delete from fdql_lookup_cache where key_hash = ?').run(victim.key_hash);
      totalBytes -= victim.size_bytes;
      evicted += 1;
      if (totalBytes <= maxBytes) break;
    }
  }
  return evicted;
}

function cacheSizeBytes(db: DatabaseSync): number {
  const row = db.prepare(
    'select sum(size_bytes) as total from fdql_lookup_cache',
  ).get() as CacheSizeRow | undefined;
  return row?.total ?? 0;
}

interface CacheRow {
  readonly expires_at_ms: number;
  readonly rows_json: string;
  readonly size_bytes: number;
}

interface CacheSizeRow {
  readonly total: number | null;
}

interface CacheVictimRow {
  readonly key_hash: string;
  readonly size_bytes: number;
}

function cacheKeyMetadata(key: unknown): {
  readonly profile: string | null;
  readonly projectId: string | null;
  readonly provider: string;
} {
  const record = isRecord(key) ? key : {};
  const source = isRecord(record['source']) ? record['source'] : {};
  const target = isRecord(source['target']) ? source['target'] : {};
  const cacheContext = isRecord(record['cacheContext']) ? record['cacheContext'] : {};
  return {
    profile: stringOrNull(cacheContext['profile']),
    projectId: stringOrNull(target['projectId']),
    provider: stringOrNull(record['provider']) ?? 'unknown',
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
