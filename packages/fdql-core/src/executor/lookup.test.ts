import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from '../compiler.ts';
import { executeFdql } from '../executor.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import { createTestProviderRuntime, testProviderDialect } from '../test-helpers/provider.ts';
import type {
  FdqlExecutionEvent,
  FdqlExecutionOptions,
  FdqlPersistentCache,
  FdqlProviderRow,
} from '../types.ts';

const compileOptions = { providers: [testProviderDialect] };
const runtime = createTestProviderRuntime({
  orders: {
    ord_1: { status: 'paid', teamId: 'team_1' },
    ord_2: { status: 'paid' },
    ord_3: { status: 'paid', teamId: 'team_missing' },
  },
  teams: {
    team_1: { id: 'team_1', name: 'Orange' },
  },
  'orders/ord_1/items': {
    item_1: { status: 'packed' },
  },
});

describe('FDQL executor lookup', () => {
  it('attaches lookup one results and counts lookup reads', async () => {
    const events = await run(`alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 1
then lookup one $teams as team
  mem where team.id = o.teamId
return o.status, team.name as teamName`);

    expect(rows(events)).toEqual([{ status: 'paid', teamName: 'Orange' }]);
    expect(completed(events)).toMatchObject({ lookupReads: 1, reads: 2, rowsOutput: 1 });
  });

  it('keeps optional lookup rows when correlated values are missing or unmatched', async () => {
    const events = await run(`alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 3
then lookup one $teams as team
  mem where team.id = o.teamId
return mem.id(o) as id, team.name as teamName`);

    expect(rows(events)).toEqual([
      { id: 'ord_1', teamName: 'Orange' },
      { id: 'ord_2' },
      { id: 'ord_3' },
    ]);
    expect(completed(events)).toMatchObject({ reads: 4, rowsOutput: 3 });
  });

  it('drops required lookup rows when correlated values are missing or unmatched', async () => {
    const events = await run(`alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 3
then lookup required one $teams as team
  mem where team.id = o.teamId
return mem.id(o) as id, team.name as teamName`);

    expect(rows(events)).toEqual([{ id: 'ord_1', teamName: 'Orange' }]);
    expect(completed(events)).toMatchObject({ rowsOutput: 1 });
  });

  it('keeps lookup many rows with empty arrays for missing correlated values', async () => {
    const events = await run(`alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 2
then lookup many $teams as teams
  mem where teams.id = o.teamId
return mem.id(o) as id, teams`);

    expect(rows(events)).toEqual([
      { id: 'ord_1', teams: [{ id: 'team_1', name: 'Orange' }] },
      { id: 'ord_2', teams: [] },
    ]);
  });

  it('dedupes repeated lookup reads with run cache', async () => {
    const events = await run(`set fdql.cache = run
alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 2
then with o, "team_1" as teamId
then lookup one $teams as team
  mem where team.id = teamId
return team.name as teamName`);

    expect(rows(events)).toEqual([{ teamName: 'Orange' }, { teamName: 'Orange' }]);
    expect(completed(events)).toMatchObject({ cacheHits: 1, cacheMisses: 1, reads: 3 });
  });

  it('uses persistent lookup cache across executions', async () => {
    const persistentCache = createMemoryPersistentCache();
    const query = `set fdql.cache = persistent
alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 1
then lookup one $teams as team
  mem where team.id = o.teamId
return team.name as teamName`;

    const first = await run(query, runtime, { persistentCache });
    const second = await run(query, runtime, { persistentCache });

    expect(completed(first)).toMatchObject({ cacheMisses: 1, cacheWrites: 1, reads: 2 });
    expect(completed(second)).toMatchObject({ cacheHits: 1, reads: 1 });
  });

  it('binds parent sources before lookup reads', async () => {
    const events = await run(`alias $orders = mem.collection("orders")
alias $items = mem.child("items")
from $orders as o
mem limit 1
then lookup many $items of o as item
return item`);

    expect(rows(events)).toEqual([{ item: [{ status: 'packed' }] }]);
  });

  it('attaches aggregate lookup defaults, values, and stats', async () => {
    const events = await run(`alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 3
then lookup aggregate $teams as stats from team
  mem where team.id = o.teamId
  yield mem.count() as total, mem.max(team.name) as lastName
return mem.id(o) as id, stats.total, stats.lastName`);

    expect(rows(events)).toEqual([
      { id: 'ord_1', total: 1, lastName: 'Orange' },
      { id: 'ord_2', total: 0, lastName: null },
      { id: 'ord_3', total: 0, lastName: null },
    ]);
    expect(completed(events)).toMatchObject({
      aggregateReads: 2,
      lookupReads: 1,
      reads: 4,
      rowsOutput: 3,
    });
  });

  it('caches aggregate lookup results', async () => {
    const events = await run(`set fdql.cache = run
alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 2
then with o, "team_1" as teamId
then lookup aggregate $teams as stats from team
  mem where team.id = teamId
  yield mem.count() as total
return stats.total as total`);

    expect(rows(events)).toEqual([{ total: 1 }, { total: 1 }]);
    expect(completed(events)).toMatchObject({
      aggregateReads: 1,
      cacheHits: 1,
      cacheMisses: 1,
      reads: 2,
    });
  });
});

async function run(
  source: string,
  selectedRuntime: FdqlProviderRuntimeRegistry = runtime,
  options: FdqlExecutionOptions = {},
): Promise<readonly FdqlExecutionEvent[]> {
  const result = compileFdqlRead(source, compileOptions);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const events: FdqlExecutionEvent[] = [];
  for await (const event of executeFdql(result.plan, selectedRuntime, options)) events.push(event);
  return events;
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
      if (!entry) return null;
      if (entry.expiresAtMs <= request.nowMs) {
        entries.delete(request.key.canonicalJson);
        return null;
      }
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

function rows(events: readonly FdqlExecutionEvent[]): readonly Record<string, unknown>[] {
  return events.flatMap((event) => event.kind === 'row' ? [event.row] : []);
}

function completed(events: readonly FdqlExecutionEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === 'completed') return event.stats;
  }
  throw new Error('Missing completed event.');
}
