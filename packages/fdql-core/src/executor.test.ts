import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from './compiler.ts';
import { executeFdql } from './executor.ts';
import type { FdqlProviderRuntimeRegistry } from './provider.ts';
import { createTestProviderRuntime, testProviderDialect } from './test-helpers/provider.ts';
import type { FdqlExecutionEvent } from './types.ts';
import { providerValue, stringValue } from './value.ts';

const compileOptions = {
  providers: [testProviderDialect],
};

const runtime = createTestProviderRuntime({
  people: {
    p1: {
      active: true,
      createdAt: '2025-10-01T00:00:00.000Z',
      metadata: { fraudScore: 0.02, tier: 'gold' },
      name: 'Vini',
      tags: ['admin'],
      teamId: 'team_1',
    },
    p2: {
      active: true,
      createdAt: '2025-10-02T00:00:00.000Z',
      name: 'Alex',
      tags: [],
      teamId: 'team_2',
    },
    p3: {
      active: false,
      createdAt: '2025-10-03T00:00:00.000Z',
      name: 'Vini',
      tags: ['admin'],
    },
  },
  rounds: {
    round_1: { createdAt: '2025-10-05T00:00:00.000Z', driverId: 'p1', status: 'done' },
    round_2: { createdAt: '2025-10-06T00:00:00.000Z', driverId: 'p1', status: 'draft' },
    round_3: { createdAt: '2025-10-07T00:00:00.000Z', driverId: 'p2', status: 'done' },
  },
  assignments: {
    a1: { teamId: 'team_1' },
    a2: { teamId: 'team_1' },
    a3: { teamId: 'team_2' },
  },
  teams: {
    team_1: { id: 'team_1', name: 'Orange' },
    team_2: { id: 'team_2', name: 'Blue' },
  },
});

describe('FDQL executor', () => {
  it('streams rows and read stats for provider and local filters', async () => {
    const events = await run(`alias $people = mem.collection("people")
from $people as p
mem where p.active = true
mem limit 10
then filter lower(p.name) = "vini"
then take 25
return mem.id(p) as id, p.name`);

    expect(rows(events)).toEqual([{ id: 'p1', name: 'Vini' }]);
    expect(completed(events)).toMatchObject({
      providerReads: { mem: 2 },
      reads: 2,
      rowsOutput: 1,
      rowsScanned: 2,
      stoppedReason: 'completed',
    });
  });

  it('emits provider-neutral row lineage', async () => {
    const events = await run(`alias $people = mem.collection("people")
from $people as p
mem where p.name = "Vini"
mem limit 1
return mem.id(p)`);

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'row',
        lineage: {
          provider: 'mem',
          readContribution: 1,
          rowPath: 'people/p1',
          source: '$people',
        },
      }),
    );
  });

  it('stops at the read budget without over-reading rows', async () => {
    const events = await run(`set fdql.readBudget = 1
alias $people = mem.collection("people")
from $people as p
mem limit 10
return mem.id(p) as id, p.name`);

    expect(rows(events)).toEqual([{ id: 'p1', name: 'Vini' }]);
    expect(completed(events)).toMatchObject({
      reads: 1,
      rowsOutput: 1,
      rowsScanned: 1,
      stoppedReason: 'budget',
    });
  });

  it('emits cancelled when the signal is aborted', async () => {
    const result = compileFdqlRead(
      `set fdql.allowUnboundedReads = true
alias $people = mem.collection("people")
from $people as p
return p.name`,
      compileOptions,
    );
    if (!result.ok) {
      throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
    }

    const events: FdqlExecutionEvent[] = [];
    const signal = { aborted: false };
    for await (const event of executeFdql(result.plan, runtime, { signal })) {
      events.push(event);
      if (event.kind === 'row') signal.aborted = true;
    }

    expect(events).toContainEqual(expect.objectContaining({ kind: 'cancelled' }));
  });

  it('passes provider limits to the runtime', async () => {
    const requests: unknown[] = [];
    const collectingRuntime: FdqlProviderRuntimeRegistry = {
      dialects: { mem: testProviderDialect },
      providers: {
        mem: {
          async *read(request) {
            requests.push(request);
            yield {
              context: { collection: 'people' },
              data: { name: stringValue('Vini') },
              id: 'p1',
              path: 'people/p1',
              provider: 'mem',
              source: request.source,
            };
          },
        },
      },
    };

    await run(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      collectingRuntime,
    );

    expect(requests).toEqual([expect.objectContaining({ limit: 1 })]);
  });

  it('attaches lookup one results and counts lookup reads', async () => {
    const events = await run(`alias $people = mem.collection("people")
alias $teams = mem.collection("teams")
from $people as p
mem where p.name = "Vini"
mem limit 1

then lookup one $teams as team
  mem where team.id = p.teamId

return mem.id(p) as id, p.name, team.name as teamName`);

    expect(rows(events)).toEqual([{ id: 'p1', name: 'Vini', teamName: 'Orange' }]);
    expect(completed(events)).toMatchObject({
      lookupReads: 1,
      reads: 2,
      rowsOutput: 1,
      rowsScanned: 2,
    });
  });

  it('dedupes repeated lookup reads when run cache is enabled', async () => {
    const events = await run(`set fdql.cache = "run"
alias $assignments = mem.collection("assignments")
alias $teams = mem.collection("teams")
from $assignments as assignment
mem limit 3

then lookup one $teams as team
  mem where team.id = assignment.teamId

return mem.id(assignment) as id, team.name as teamName`);

    expect(rows(events)).toEqual([
      { id: 'a1', teamName: 'Orange' },
      { id: 'a2', teamName: 'Orange' },
      { id: 'a3', teamName: 'Blue' },
    ]);
    expect(completed(events)).toMatchObject({
      cacheHits: 1,
      cacheMisses: 2,
      lookupReads: 2,
      reads: 5,
      rowsOutput: 3,
      rowsScanned: 5,
    });
  });

  it('runs repeated lookup reads when run cache is off', async () => {
    const events = await run(`set fdql.cache = "off"
alias $assignments = mem.collection("assignments")
alias $teams = mem.collection("teams")
from $assignments as assignment
mem limit 3

then lookup one $teams as team
  mem where team.id = assignment.teamId

return mem.id(assignment) as id, team.name as teamName`);

    expect(rows(events)).toHaveLength(3);
    expect(completed(events)).toMatchObject({
      cacheHits: 0,
      cacheMisses: 0,
      lookupReads: 3,
      reads: 6,
      rowsScanned: 6,
    });
  });

  it('keeps lookup cache keys separate by field mask, limit, and correlated values', async () => {
    const events = await run(`set fdql.cache = "run"
alias $assignments = mem.collection("assignments")
alias $teamNames = mem.collection("teams", ["name"])
alias $teamIds = mem.collection("teams", ["id"])
from $assignments as assignment
mem limit 2

then lookup one $teamNames as teamName
  mem where teamName.id = assignment.teamId

then lookup one $teamIds as teamId
  mem where teamId.id = assignment.teamId
  mem limit 1

return mem.id(assignment) as id, teamName.name as teamName, teamId.id as teamId`);

    expect(rows(events)).toEqual([
      { id: 'a1', teamId: 'team_1', teamName: 'Orange' },
      { id: 'a2', teamId: 'team_1', teamName: 'Orange' },
    ]);
    expect(completed(events)).toMatchObject({
      cacheHits: 2,
      cacheMisses: 2,
      lookupReads: 2,
      reads: 4,
      rowsScanned: 4,
    });
  });

  it('attaches lookup many arrays', async () => {
    const events = await run(`alias $people = mem.collection("people")
alias $rounds = mem.collection("rounds")
from $people as p
mem where p.name = "Vini"
mem limit 1

then lookup many $rounds as rounds
  mem where rounds.driverId = mem.id(p)
  mem limit 2

return mem.id(p) as id, rounds`);

    expect(rows(events)).toEqual([
      {
        id: 'p1',
        rounds: [
          { createdAt: '2025-10-05T00:00:00.000Z', driverId: 'p1', status: 'done' },
          { createdAt: '2025-10-06T00:00:00.000Z', driverId: 'p1', status: 'draft' },
        ],
      },
    ]);
    expect(completed(events)).toMatchObject({ lookupReads: 2, reads: 3, rowsOutput: 1 });
  });

  it('unwinds array fields into separate rows', async () => {
    const events = await run(`alias $people = mem.collection("people")
from $people as p
mem limit 3

then unwind p.tags as tag

return mem.id(p) as id, tag`);

    expect(rows(events)).toEqual([
      { id: 'p1', tag: 'admin' },
      { id: 'p3', tag: 'admin' },
    ]);
    expect(completed(events)).toMatchObject({ reads: 3, rowsOutput: 2, rowsScanned: 3 });
  });

  it('unwinds map entries and reads dynamic map values', async () => {
    const events = await run(`alias $people = mem.collection("people")
from $people as p
mem where p.name = "Vini"
mem limit 1

then unwind entries(p.metadata) as entry

return entry.key, entry.value, mapGet(p.metadata, entry.key) as dynamicValue`);

    expect(rows(events)).toEqual([
      { dynamicValue: 0.02, key: 'fraudScore', value: 0.02 },
      { dynamicValue: 'gold', key: 'tier', value: 'gold' },
    ]);
    expect(completed(events)).toMatchObject({ reads: 1, rowsOutput: 2 });
  });

  it('sorts local rows before returning them', async () => {
    const events = await run(`alias $people = mem.collection("people")
from $people as p
mem limit 3

then sort by p.name asc

return mem.id(p) as id, p.name`);

    expect(rows(events)).toEqual([
      { id: 'p2', name: 'Alex' },
      { id: 'p1', name: 'Vini' },
      { id: 'p3', name: 'Vini' },
    ]);
  });

  it('aggregates bounded local rows', async () => {
    const events = await run(`alias $rounds = mem.collection("rounds")
from $rounds as r
mem limit 10

then aggregate
  by r.driverId as driverId
  count() as total,
  max(r.createdAt) as lastRoundAt

return driverId, total, lastRoundAt`);

    expect(rows(events)).toEqual([
      { driverId: 'p1', lastRoundAt: '2025-10-06T00:00:00.000Z', total: 2 },
      { driverId: 'p2', lastRoundAt: '2025-10-07T00:00:00.000Z', total: 1 },
    ]);
    expect(completed(events)).toMatchObject({ aggregateSourceRows: 3, reads: 3, rowsOutput: 2 });
  });

  it('executes top-level union all branches with shared aliases', async () => {
    const events = await run(`alias $people = mem.collection("people")
alias $teams = mem.collection("teams")

from $people as p
mem where p.name = "Vini"
mem limit 1
return mem.id(p) as id, "person" as type

union all

from $teams as t
mem where t.name = "Orange"
mem limit 1
return mem.id(t) as id, "team" as type`);

    expect(rows(events)).toEqual([
      { id: 'p1', type: 'person' },
      { id: 'team_1', type: 'team' },
    ]);
    expect(completed(events)).toMatchObject({ reads: 2, rowsOutput: 2, unionBranches: 2 });
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
            async *read(request) {
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
  selectedRuntime = runtime,
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
