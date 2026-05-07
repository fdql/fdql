import type { FdqlPersistentCacheKey, FdqlProviderRow } from '@firebase-desk/fdql';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFdqlPersistentCacheStore,
  type FdqlPersistentCacheStore,
} from './fdql-persistent-cache.ts';

let tempDirs: string[] = [];
let caches: FdqlPersistentCacheStore[] = [];

afterEach(async () => {
  for (const cache of caches) cache.close();
  caches = [];
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs = [];
});

describe('FDQL persistent cache store', () => {
  it('returns cached rows until TTL expires', async () => {
    const cache = await createCache();
    const key = cacheKey('orders', 'local');
    const rows = [providerRow('orders/ord_1')];

    await cache.set({ expiresAtMs: 2_000, key, nowMs: 1_000, rows });

    await expect(cache.get({ key, nowMs: 1_500 })).resolves.toMatchObject({ rows });
    await expect(cache.get({ key, nowMs: 2_000 })).resolves.toBeNull();
  });

  it('evicts least recently used entries over the size cap', async () => {
    const cache = await createCache({ maxBytes: 1_600 });
    const first = cacheKey('orders', 'local');
    const second = cacheKey('drivers', 'local');
    const third = cacheKey('teams', 'local');

    await cache.set({
      expiresAtMs: 10_000,
      key: first,
      nowMs: 1_000,
      rows: [providerRow('a', 'a'.repeat(200))],
    });
    await cache.set({
      expiresAtMs: 10_000,
      key: second,
      nowMs: 2_000,
      rows: [providerRow('b', 'b'.repeat(200))],
    });
    await cache.get({ key: first, nowMs: 3_000 });
    const result = await cache.set({
      expiresAtMs: 10_000,
      key: third,
      nowMs: 4_000,
      rows: [providerRow('c', 'c'.repeat(200))],
    });

    expect(result.evictedEntries).toBeGreaterThan(0);
    await expect(cache.get({ key: first, nowMs: 5_000 })).resolves.toMatchObject({
      rows: [providerRow('a', 'a'.repeat(200))],
    });
    await expect(cache.get({ key: second, nowMs: 5_000 })).resolves.toBeNull();
  });

  it('clears entries by provider and project', async () => {
    const cache = await createCache();
    const local = cacheKey('orders', 'local');
    const prod = cacheKey('orders', 'prod');

    await cache.set({ expiresAtMs: 10_000, key: local, nowMs: 1_000, rows: [providerRow('a')] });
    await cache.set({ expiresAtMs: 10_000, key: prod, nowMs: 1_000, rows: [providerRow('b')] });
    await cache.clear?.({ projectId: 'local', provider: 'mem' });

    await expect(cache.get({ key: local, nowMs: 2_000 })).resolves.toBeNull();
    await expect(cache.get({ key: prod, nowMs: 2_000 })).resolves.toMatchObject({
      rows: [providerRow('b')],
    });
  });
});

async function createCache(
  options?: Parameters<typeof createFdqlPersistentCacheStore>[1],
): Promise<FdqlPersistentCacheStore> {
  const cache = createFdqlPersistentCacheStore(await tempDir(), options);
  caches.push(cache);
  return cache;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'firebase-desk-fdql-cache-'));
  tempDirs.push(dir);
  return dir;
}

function cacheKey(collection: string, projectId: string): FdqlPersistentCacheKey {
  const key = {
    cacheContext: { profile: 'test' },
    fieldMask: { kind: 'full' },
    formatVersion: 1,
    limit: 1,
    orderBy: null,
    predicate: null,
    provider: 'mem',
    providerCacheVersion: 1,
    source: {
      provider: 'mem',
      sourceType: 'collection',
      target: { collection, projectId },
    },
  };
  return { canonicalJson: JSON.stringify(key), key };
}

function providerRow(path: string, payload = ''): FdqlProviderRow {
  return {
    context: { projectId: 'local' },
    data: payload ? { payload: { kind: 'string', value: payload } } : {},
    id: path.split('/').at(-1) ?? path,
    path,
    provider: 'mem',
    source: {
      provider: 'mem',
      sourceAlias: '$source',
      sourceType: 'collection',
      target: { collection: path.split('/')[0] ?? '', projectId: 'local' },
    },
  };
}
