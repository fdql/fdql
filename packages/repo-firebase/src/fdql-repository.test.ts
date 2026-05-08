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

  it('maps common FDQL predicates to native Firestore filters', async () => {
    const query = fakeQuery([fakeSnapshot('drv_1', 'drivers/drv_1', {})]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $drivers = fs.collection("drivers", [])
from $drivers as d
fs where d.status not in ["deleted"]
fs limit 1
return fs.id(d) as id`,
    });
    expectFilter(query.where.mock.calls.at(-1)?.[0], ['status'], 'not-in', ['deleted']);

    await repository.run({
      connectionId: 'local',
      runId: 'run_2',
      source: `alias $drivers = fs.collection("drivers", [])
from $drivers as d
fs where d.deletedAt is null
fs limit 1
return fs.id(d) as id`,
    });
    expectFilter(query.where.mock.calls.at(-1)?.[0], ['deletedAt'], '==', null);

    await repository.run({
      connectionId: 'local',
      runId: 'run_3',
      source: `alias $drivers = fs.collection("drivers", [])
from $drivers as d
fs where d.deletedAt is not null
fs limit 1
return fs.id(d) as id`,
    });
    expectFilter(query.where.mock.calls.at(-1)?.[0], ['deletedAt'], '!=', null);

    await repository.run({
      connectionId: 'local',
      runId: 'run_4',
      source: `alias $drivers = fs.collection("drivers", [])
from $drivers as d
fs where fs.arrayContainsAny(d.tags, ["admin", "staff"])
fs limit 1
return fs.id(d) as id`,
    });
    expectFilter(
      query.where.mock.calls.at(-1)?.[0],
      ['tags'],
      'array-contains-any',
      ['admin', 'staff'],
    );
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

  it('stops pending live reads on cancel without emitting rows', async () => {
    const query = pendingQuery();
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));
    const events: string[] = [];
    const unsubscribe = repository.subscribe((event) => events.push(event.type));

    const resultPromise = repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders", [])
from $orders as o
fs limit 1
return fs.id(o) as id`,
    });

    await waitUntil(() => query.get.mock.calls.length > 0);
    await repository.cancel('run_1');
    const result = await resultPromise;
    unsubscribe();

    expect(result).toMatchObject({
      cancelled: true,
      rows: [],
      stats: { reads: 0, rowsOutput: 0, rowsScanned: 0, stoppedReason: 'cancelled' },
    });
    expect(events).not.toContain('read');
    expect(events).not.toContain('row');
  });

  it('stops pending live reads on timeout without emitting rows', async () => {
    const query = pendingQuery();
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      execution: { timeoutMs: 1 },
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders", [])
from $orders as o
fs limit 1
return fs.id(o) as id`,
    });

    expect(result).toMatchObject({
      rows: [],
      stats: { reads: 0, rowsOutput: 0, rowsScanned: 0, stoppedReason: 'timeout' },
    });
  });

  it('uses exact Firestore field path segments for masks and ordering', async () => {
    const query = fakeQuery([fakeSnapshot('evt_1', 'events/evt_1', {})]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source:
        `alias $events = fs.collection("events", ["schedule.startsAt", fs.fieldPath("literal.with.dot")])
from $events as e
fs order by fs.fieldPath("literal.with.dot") desc
fs limit 1
return fs.id(e) as id`,
    });

    expect(query.select).toHaveBeenCalledWith(
      expectFieldPath(['schedule', 'startsAt']),
      expectFieldPath(['literal.with.dot']),
    );
    expect(query.orderBy).toHaveBeenCalledWith(expectFieldPath(['literal.with.dot']), 'desc');
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

  it('reads static and dynamic subcollection sources', async () => {
    const ordersQuery = fakeQuery([fakeSnapshot('ord_1', 'orders/ord_1', { status: 'paid' })]);
    const itemsQueries: ReturnType<typeof fakeQuery>[] = [];
    const db = {
      collection: vi.fn((path: string) => {
        if (path === 'orders') return ordersQuery;
        const query = fakeQuery([
          fakeSnapshot('item_1', 'orders/ord_1/items/item_1', { status: 'picked' }),
        ]);
        itemsQueries.push(query);
        return query;
      }),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const staticResult = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $items = fs.subcollection("orders/ord_1", "items", ["status"])
from $items as item
fs limit 1
return fs.id(item) as id, item.status`,
    });
    const dynamicResult = await repository.run({
      connectionId: 'local',
      runId: 'run_2',
      source: `alias $orders = fs.collection("orders", [])
from $orders as order
fs limit 1
then lookup many fs.subcollection(order, "items", ["status"]) as items
return fs.id(order) as id, items`,
    });

    expect(db.collection).toHaveBeenCalledWith('orders/ord_1/items');
    expect(itemsQueries[0]?.select).toHaveBeenCalledWith(expectFieldPath(['status']));
    expect(itemsQueries[1]?.select).toHaveBeenCalledWith(expectFieldPath(['status']));
    expect(staticResult.rows).toEqual([{ id: 'item_1', status: 'picked' }]);
    expect(dynamicResult.rows).toEqual([{ id: 'ord_1', items: [{ status: 'picked' }] }]);
    expect(dynamicResult.stats).toMatchObject({ lookupReads: 1, reads: 2, rowsOutput: 1 });
  });

  it('keeps optional lookup rows when correlated values are missing', async () => {
    const driversQuery = fakeQuery([
      fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini' }),
    ]);
    const teamsQuery = fakeQuery([]);
    const db = {
      collection: vi.fn((path: string) => path === 'drivers' ? driversQuery : teamsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $drivers = fs.collection("drivers", ["firstName"])
alias $teams = fs.collection("teams", ["name"])
from $drivers as d
fs limit 1
then lookup one $teams as team
  fs where fs.id(team) = d.teamId
return fs.id(d) as id, team.name as teamName`,
    });

    expect(teamsQuery.where).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{ id: 'drv_1' }],
      stats: { lookupReads: 0, reads: 1, rowsOutput: 1, rowsScanned: 1 },
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

  it('runs provider aggregate stages with native aggregate and bounded min max reads', async () => {
    const driversQuery = fakeQuery([fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini' })]);
    const roundsQuery = fakeQuery([]);
    roundsQuery.aggregate = vi.fn((_spec: unknown) => ({
      get: vi.fn(async () => ({ data: () => ({ __fdql_0: 2, __fdql_1: 30 }) })),
    }));
    roundsQuery.get = vi.fn(async () => ({
      docs: [fakeSnapshot('rnd_2', 'rounds/rnd_2', { createdAt: '2026-02-01T00:00:00.000Z' })],
    }));
    const db = {
      collection: vi.fn((path: string) => path === 'drivers' ? driversQuery : roundsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $drivers = fs.collection("drivers", ["firstName"])
alias $rounds = fs.collection("rounds", ["driverId", "points", "createdAt"])
from $drivers as d
fs limit 1
then fs.aggregate $rounds as round
  fs where round.driverId = fs.id(d)
  yield fs.count() as total, fs.sum(round.points) as points, fs.max(round.createdAt) as lastRoundAt
return fs.id(d) as id, total, points, lastRoundAt`,
    });

    expect(roundsQuery.aggregate).toHaveBeenCalledTimes(1);
    expect(roundsQuery.orderBy).toHaveBeenCalledWith(expectFieldPath(['createdAt']), 'desc');
    expect(roundsQuery.limit).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{
        id: 'drv_1',
        lastRoundAt: '2026-02-01T00:00:00.000Z',
        points: 30,
        total: 2,
      }],
      stats: { aggregateReads: 1, lookupReads: 1, reads: 2, rowsOutput: 1 },
    });
  });

  it('runs top-level aggregate sources with native aggregate and bounded min max reads', async () => {
    const roundsQuery = fakeQuery([
      [fakeSnapshot('rnd_1', 'rounds/rnd_1', { createdAt: '2026-01-01T00:00:00.000Z' })],
      [fakeSnapshot('rnd_2', 'rounds/rnd_2', { createdAt: '2026-02-01T00:00:00.000Z' })],
    ]);
    roundsQuery.aggregate = vi.fn((_spec: unknown) => ({
      get: vi.fn(async () => ({
        data: () => ({ __fdql_0: 2, __fdql_1: 30, __fdql_2: 15 }),
      })),
    }));
    const db = {
      collection: vi.fn(() => roundsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $rounds = fs.collection("rounds", ["points", "createdAt"])
from fs.aggregate $rounds as round
  yield fs.count() as total, fs.sum(round.points) as points, fs.avg(round.points) as avgPoints, fs.min(round.createdAt) as firstRoundAt, fs.max(round.createdAt) as lastRoundAt
return total, points, avgPoints, firstRoundAt, lastRoundAt`,
    });

    expect(db.collection).toHaveBeenCalledWith('rounds');
    expect(roundsQuery.aggregate).toHaveBeenCalledTimes(1);
    expect(roundsQuery.orderBy).toHaveBeenCalledWith(expectFieldPath(['createdAt']), 'asc');
    expect(roundsQuery.orderBy).toHaveBeenCalledWith(expectFieldPath(['createdAt']), 'desc');
    expect(roundsQuery.limit).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{
        avgPoints: 15,
        firstRoundAt: '2026-01-01T00:00:00.000Z',
        lastRoundAt: '2026-02-01T00:00:00.000Z',
        points: 30,
        total: 2,
      }],
      stats: { aggregateReads: 1, reads: 2, rowsOutput: 1, rowsScanned: 2 },
    });
  });

  it('runs static subcollection aggregate sources', async () => {
    const itemsQuery = fakeQuery([]);
    itemsQuery.aggregate = vi.fn((_spec: unknown) => ({
      get: vi.fn(async () => ({ data: () => ({ __fdql_0: 2 }) })),
    }));
    const db = {
      collection: vi.fn(() => itemsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `from fs.aggregate fs.subcollection("orders/ord_1", "items", ["status"])
  yield fs.count() as total
return total`,
    });

    expect(db.collection).toHaveBeenCalledWith('orders/ord_1/items');
    expect(itemsQuery.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{ total: 2 }],
      stats: { aggregateReads: 1, reads: 0, rowsOutput: 1 },
    });
  });

  it('caches provider aggregate stage results', async () => {
    const driversQuery = fakeQuery([
      fakeSnapshot('drv_1', 'drivers/drv_1', { firstName: 'Vini', teamId: 'team_1' }),
      fakeSnapshot('drv_2', 'drivers/drv_2', { firstName: 'Alex', teamId: 'team_1' }),
    ]);
    const teamsQuery = fakeQuery([]);
    teamsQuery.aggregate = vi.fn((_spec: unknown) => ({
      get: vi.fn(async () => ({ data: () => ({ __fdql_0: 1 }) })),
    }));
    const db = {
      collection: vi.fn((path: string) => path === 'drivers' ? driversQuery : teamsQuery),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `set fdql.cache = run
alias $drivers = fs.collection("drivers", ["firstName", "teamId"])
alias $teams = fs.collection("teams", ["name"])
from $drivers as d
fs limit 2
then fs.aggregate $teams as team
  fs where fs.id(team) = d.teamId
  yield fs.count() as total
return fs.id(d) as id, total`,
    });

    expect(teamsQuery.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      rows: [{ id: 'drv_1', total: 1 }, { id: 'drv_2', total: 1 }],
      stats: { aggregateReads: 1, cacheHits: 1, cacheMisses: 1, reads: 2, rowsOutput: 2 },
    });
  });

  it('runs cache clear commands through persistent cache', async () => {
    const clear = vi.fn(async () => ({ clearedEntries: 12 }));
    const repository = createFirebaseFdqlRepository(providerFor({ collection: vi.fn() }), {
      persistentCache: {
        clear,
        async get() {
          return null;
        },
        async set() {
          return { evictedEntries: 0, sizeBytes: 0 };
        },
      },
    });

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: 'clear cache provider fs project "local"',
    });

    expect(clear).toHaveBeenCalledWith({ profile: 'desktop', projectId: 'local', provider: 'fs' });
    expect(result).toMatchObject({
      command: {
        clearedEntries: 12,
        kind: 'clearCache',
        message: 'Cleared 12 cache entries.',
      },
      diagnostics: [],
      rows: [],
      stats: null,
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
    aggregate: vi.fn((_spec: unknown) => ({
      get: vi.fn(async () => ({ data: () => ({}) })),
    })),
    get: vi.fn(async () => ({ docs: pages[pageIndex++] ?? [] })),
    limit: vi.fn((_limit: number) => query),
    orderBy: vi.fn((_field: FieldPath | string, _direction: 'asc' | 'desc') => query),
    select: vi.fn((..._fields: FieldPath[]) => query),
    startAfter: vi.fn((_document: unknown) => query),
    where: vi.fn((_filter: unknown) => query),
  };
  return query;
}

function pendingQuery() {
  const query = {
    aggregate: vi.fn((_spec: unknown) => ({
      get: vi.fn(async () => ({ data: () => ({}) })),
    })),
    get: vi.fn(async () => await new Promise<{ readonly docs: readonly unknown[]; }>(() => {})),
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

function expectFilter(
  filter: unknown,
  path: readonly string[],
  operator: string,
  value: unknown,
) {
  expect(filter).toMatchObject({ operator, value });
  expect((filter as { readonly field?: FieldPath; }).field).toEqual(expectFieldPath(path));
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
    async clear() {
      const clearedEntries = entries.size;
      entries.clear();
      return { clearedEntries };
    },
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

function waitUntil(predicate: () => boolean, attempt = 0): Promise<void> {
  if (predicate()) return Promise.resolve();
  if (attempt >= 20) return Promise.reject(new Error('Timed out waiting for condition.'));
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
    waitUntil(predicate, attempt + 1)
  );
}
