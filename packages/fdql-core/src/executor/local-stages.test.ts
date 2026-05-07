import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from '../compiler.ts';
import { executeFdql } from '../executor.ts';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import { createTestProviderRuntime, testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlExecutionEvent, FdqlProviderReadRequest } from '../types.ts';
import { providerValue, stringValue } from '../value.ts';

const compileOptions = { providers: [testProviderDialect] };
const runtime = createTestProviderRuntime({
  games: {
    g1: {
      entriesById: {
        e1: { driverId: 'p1', score: 10 },
        e2: { driverId: 'p2', score: 5 },
      },
      name: 'Race',
    },
  },
  rounds: {
    round_1: { createdAt: '2025-10-05T00:00:00.000Z', driverId: 'p1', status: 'done' },
    round_2: { createdAt: '2025-10-06T00:00:00.000Z', driverId: 'p1', status: 'draft' },
    round_3: { createdAt: '2025-10-07T00:00:00.000Z', driverId: 'p2', status: 'done' },
  },
});

describe('FDQL executor local stages', () => {
  it('unwinds map entries and reads dynamic map values', async () => {
    const events = await run(`alias $games = mem.collection("games")
from $games as g
mem limit 1
then unwind entries(g.entriesById) as entry
return entry.key as entryId, entry.value.driverId as driverId`);

    expect(rows(events)).toEqual([
      { driverId: 'p1', entryId: 'e1' },
      { driverId: 'p2', entryId: 'e2' },
    ]);
  });

  it('sorts and aggregates local rows', async () => {
    const events = await run(`alias $rounds = mem.collection("rounds")
from $rounds as r
mem limit 10
then sort by r.createdAt desc
then aggregate
  by r.driverId as driverId
  count() as total,
  max(r.createdAt) as lastRoundAt
return driverId, total, lastRoundAt`);

    expect(rows(events)).toEqual([
      { driverId: 'p2', lastRoundAt: '2025-10-07T00:00:00.000Z', total: 1 },
      { driverId: 'p1', lastRoundAt: '2025-10-06T00:00:00.000Z', total: 2 },
    ]);
    expect(completed(events)).toMatchObject({ aggregateSourceRows: 3 });
  });

  it('executes top-level union all branches', async () => {
    const events = await run(`alias $games = mem.collection("games")
alias $rounds = mem.collection("rounds")
from $games as g
mem limit 1
return mem.id(g) as id
union all
from $rounds as r
mem limit 1
return mem.id(r) as id`);

    expect(rows(events)).toEqual([{ id: 'g1' }, { id: 'round_1' }]);
    expect(completed(events)).toMatchObject({ rowsOutput: 2, unionBranches: 2 });
  });

  it('fails when local equality compares provider values without equality keys', async () => {
    const events = await run(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
then filter p.ref = p.ref
return mem.id(p) as id`,
      {
        dialects: { mem: testProviderDialect },
        providers: {
          mem: {
            async *read(request: FdqlProviderReadRequest) {
              yield {
                context: { collection: 'people' },
                data: {
                  ref: providerValue({
                    provider: 'mem',
                    value: { path: stringValue('people/p1') },
                    valueType: 'ref',
                  }),
                },
                id: 'p1',
                path: 'people/p1',
                provider: 'mem',
                source: request.source,
              };
            },
          },
        },
      },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          code: 'FDQL_EXECUTION_FAILED',
          message: 'Provider values cannot be compared without equality keys.',
        }),
        kind: 'failed',
      }),
    );
  });
});

async function run(
  source: string,
  selectedRuntime: FdqlProviderRuntimeRegistry = runtime,
): Promise<readonly FdqlExecutionEvent[]> {
  const result = compileFdqlRead(source, compileOptions);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const events: FdqlExecutionEvent[] = [];
  for await (const event of executeFdql(result.plan, selectedRuntime)) events.push(event);
  return events;
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
