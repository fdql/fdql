import type { FdqlPersistentCache, FdqlProviderRow } from '@firebase-desk/fdql';
import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { FieldPath } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { AdminFirestoreProvider } from './admin-firestore-provider.ts';
import { createFirebaseFdqlRepository } from './fdql-repository.ts';

describe('Firebase FDQL repository', () => {
  it('runs Firestore where, order, limit, and metadata-only field masks', async () => {
    const query = fakeQuery([fakeSnapshot('ord_1', 'orders/ord_1', {})]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders", [])
from $orders as o
fs where o.status = "paid"
fs order by o.total desc
fs limit 1
return fs.id(o) as id`,
    });

    expect(db.collection).toHaveBeenCalledWith('orders');
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.orderBy).toHaveBeenCalledWith(expectFieldPath(['total']), 'desc');
    expect(query.select).toHaveBeenCalledWith();
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{ id: 'ord_1' }],
      stats: { reads: 1, rowsOutput: 1, rowsScanned: 1 },
    });
  });

  it('pages live reads and caps pages by read budget', async () => {
    const query = fakeQuery([
      [fakeSnapshot('ord_1', 'orders/ord_1', {})],
      [fakeSnapshot('ord_2', 'orders/ord_2', {})],
      [fakeSnapshot('ord_3', 'orders/ord_3', {})],
    ]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      execution: { pageSize: 1, readBudget: 2 },
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders", [])
from $orders as o
fs limit 10
return fs.id(o) as id`,
    });

    expect(query.get).toHaveBeenCalledTimes(2);
    expect(query.limit).toHaveBeenNthCalledWith(1, 1);
    expect(query.limit).toHaveBeenNthCalledWith(2, 1);
    expect(query.startAfter).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{ id: 'ord_1' }, { id: 'ord_2' }],
      stats: { reads: 2, rowsOutput: 2, rowsScanned: 2, stoppedReason: 'budget' },
    });
  });

  it('runs correlated lookup reads', async () => {
    const driversQuery = fakeQuery([
      [fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini', teamId: 'team_1' })],
      [fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini', teamId: 'team_1' })],
    ]);
    const teamsQuery = fakeQuery([fakeSnapshot('team_1', 'teams/team_1', { name: 'Orange' })]);
    const db = {
      collection: vi.fn((path: string) => path === 'drivers' ? driversQuery : teamsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $drivers = fs.collection("drivers", ["firstName", "teamId"])
alias $teams = fs.collection("teams", ["name"])
from $drivers as d
fs where fs.id(d) = "drv_1"
then lookup one $teams as team
  fs where fs.id(team) = d.teamId
return fs.id(d) as id, team.name as teamName`,
    });

    expect(db.collection).toHaveBeenCalledWith('drivers');
    expect(db.collection).toHaveBeenCalledWith('teams');
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{ id: 'drv_1', teamName: 'Orange' }],
      stats: { lookupReads: 1, reads: 2, rowsOutput: 1, rowsScanned: 2 },
    });
  });

  it('dedupes repeated correlated lookup reads with lookup-local run cache', async () => {
    const driversQuery = fakeQuery([
      fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini', teamId: 'team_1' }),
      fakeSnapshot('drv_2', 'drivers/drv_2', { firstName: 'Alex', teamId: 'team_1' }),
    ]);
    const teamsQuery = fakeQuery([fakeSnapshot('team_1', 'teams/team_1', { name: 'Orange' })]);
    const db = {
      collection: vi.fn((path: string) => path === 'drivers' ? driversQuery : teamsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `set fdql.cache = off
alias $drivers = fs.collection("drivers", ["firstName", "teamId"])
alias $teams = fs.collection("teams", ["name"])
from $drivers as d
fs limit 2
then lookup one $teams as team cache run
  fs where fs.id(team) = d.teamId
return fs.id(d) as id, team.name as teamName`,
    });

    expect(teamsQuery.get).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [
        { id: 'drv_1', teamName: 'Orange' },
        { id: 'drv_2', teamName: 'Orange' },
      ],
      stats: {
        cacheHits: 1,
        cacheMisses: 1,
        lookupReads: 1,
        reads: 3,
        rowsOutput: 2,
        rowsScanned: 3,
      },
    });
  });

  it('uses persistent cache across repository runs', async () => {
    const persistentCache = createMemoryPersistentCache();
    const driversQuery = fakeQuery([
      [fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini', teamId: 'team_1' })],
      [fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini', teamId: 'team_1' })],
    ]);
    const teamsQuery = fakeQuery([fakeSnapshot('team_1', 'teams/team_1', { name: 'Orange' })]);
    const db = {
      collection: vi.fn((path: string) => path === 'drivers' ? driversQuery : teamsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db), { persistentCache });
    const request = {
      connectionId: 'local',
      runId: 'run_1',
      source: `set fdql.cache = persistent
alias $drivers = fs.collection("drivers", ["firstName", "teamId"])
alias $teams = fs.collection("teams", ["name"])
from $drivers as d
fs limit 1
then lookup one $teams as team
  fs where fs.id(team) = d.teamId
return fs.id(d) as id, team.name as teamName`,
    };

    await repository.run(request);
    const result = await repository.run({ ...request, runId: 'run_2' });

    expect(teamsQuery.get).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      rows: [{ id: 'drv_1', teamName: 'Orange' }],
      stats: { cacheHits: 1, lookupReads: 0, reads: 1, rowsOutput: 1 },
    });
  });

  it('returns compile diagnostics without touching Firestore', async () => {
    const db = {
      collection: vi.fn(),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders")
from $orders as o
fs limit 1
fs limit 2
return fs.id(o) as id`,
    });

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE' }),
    );
    expect(db.collection).not.toHaveBeenCalled();
  });
});

function fakeQuery(docsOrPages: readonly unknown[] | readonly (readonly unknown[])[]) {
  const pages = Array.isArray(docsOrPages[0])
    ? docsOrPages as readonly (readonly unknown[])[]
    : [docsOrPages as readonly unknown[]];
  let pageIndex = 0;
  const query = {
    get: vi.fn(async () => ({ docs: pages[pageIndex++] ?? [] })),
    limit: vi.fn((_limit: number) => query),
    orderBy: vi.fn((_field: FieldPath | string, _direction: 'asc' | 'desc') => query),
    select: vi.fn((..._fields: FieldPath[]) => query),
    startAfter: vi.fn((_document: unknown) => query),
    where: vi.fn((_filter: unknown) => query),
  };
  return query;
}

function fakeSnapshot(id: string, path: string, data: Record<string, unknown>) {
  return {
    data: () => data,
    id,
    ref: {
      parent: { path: path.split('/').slice(0, -1).join('/') },
      path,
    },
  };
}

function expectFieldPath(path: readonly string[]) {
  return {
    asymmetricMatch(value: unknown) {
      return typeof value === 'object'
        && value !== null
        && 'isEqual' in value
        && (value as FieldPath).isEqual(new FieldPath(...path));
    },
    toString() {
      return `FieldPath(${path.join('.')})`;
    },
  };
}

function providerFor(db: unknown): AdminFirestoreProvider {
  return {
    getFirestoreConnection: vi.fn(async (connectionId: string) => ({
      config: {
        credentialJson: null,
        project: project(connectionId),
      },
      db,
    })),
  } as unknown as AdminFirestoreProvider;
}

function createMemoryPersistentCache(): FdqlPersistentCache {
  const entries = new Map<
    string,
    {
      readonly expiresAtMs: number;
      readonly rows: readonly FdqlProviderRow[];
      readonly sizeBytes: number;
    }
  >();
  return {
    async get(request) {
      const entry = entries.get(request.key.canonicalJson);
      if (!entry || entry.expiresAtMs <= request.nowMs) return null;
      return { rows: entry.rows, sizeBytes: entry.sizeBytes };
    },
    async set(request) {
      const sizeBytes = JSON.stringify(request.rows).length;
      entries.set(request.key.canonicalJson, {
        expiresAtMs: request.expiresAtMs,
        rows: request.rows,
        sizeBytes,
      });
      return { evictedEntries: 0, sizeBytes };
    },
  };
}

function project(projectId: string): ProjectSummary {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    credentialEncrypted: null,
    hasCredential: false,
    id: projectId,
    name: projectId,
    projectId,
    target: 'emulator',
  };
}
