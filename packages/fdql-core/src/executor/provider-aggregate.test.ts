import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from '../compiler.ts';
import { executeFdql } from '../executor.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import { createTestProviderRuntime, testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlExecutionEvent, FdqlExecutionOptions } from '../types.ts';

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
});

describe('FDQL executor provider aggregate', () => {
  it('appends defaults, values, and stats to pipeline rows', async () => {
    const events = await run(`alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 3
then mem.aggregate $teams as team
  mem where team.id = o.teamId
  yield mem.count() as total, mem.max(team.name) as lastName
return mem.id(o) as id, total, lastName`);

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

  it('returns object yield maps through wildcard projection', async () => {
    const events = await run(
      `alias $orders = mem.collection("orders", [])
alias $teams = mem.collection("teams")
from $orders as order
mem limit 1
then mem.aggregate $teams
  yield { mem.count() as total } as stats
return *`,
      createTestProviderRuntime({
        orders: { ord_1: {} },
        teams: { team_1: { name: 'Orange' } },
      }),
    );

    expect(rows(events)).toEqual([{ order: {}, stats: { total: 1 } }]);
  });

  it('caches provider aggregate results', async () => {
    const events = await run(`set fdql.cache = run
alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as o
mem limit 2
then with o, "team_1" as teamId
then mem.aggregate $teams as team
  mem where team.id = teamId
  yield mem.count() as total
return total`);

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

function rows(events: readonly FdqlExecutionEvent[]): readonly Record<string, unknown>[] {
  return events.flatMap((event) => event.kind === 'row' ? [event.row] : []);
}

function completed(events: readonly FdqlExecutionEvent[]) {
  return events.find((event) => event.kind === 'completed')?.stats;
}
