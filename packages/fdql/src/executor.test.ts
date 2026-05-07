import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from './compiler.ts';
import { executeFdql } from './executor.ts';
import { firestoreProviderDialect } from './fs-dialect.ts';
import type { FdqlProviderRuntimeRegistry } from './provider.ts';
import { createTestFirestoreRuntime } from './test-helpers/firestore-runtime.ts';
import { createTestProviderRuntime, testProviderDialect } from './test-helpers/provider.ts';
import type { FdqlExecutionEvent } from './types.ts';
import { providerValue, stringValue } from './value.ts';

const compileOptions = {
  defaultProviderContext: { fs: { projectId: 'local' } },
  providers: [firestoreProviderDialect],
};

const runtime = createTestFirestoreRuntime({
  projects: {
    local: {
      drivers: {
        drv_1: {
          active: true,
          createdAt: '2025-10-01T00:00:00.000Z',
          firstName: 'Vini',
          lastName: 'Carneiro',
          metadata: { fraudScore: 0.02, tier: 'gold' },
          tags: ['admin'],
          teamId: 'team_1',
        },
        drv_2: {
          active: true,
          createdAt: '2025-10-02T00:00:00.000Z',
          firstName: 'Alex',
          lastName: 'Smith',
          tags: [],
          teamId: 'team_2',
        },
        drv_3: {
          active: false,
          createdAt: '2025-10-03T00:00:00.000Z',
          firstName: 'Vini',
          lastName: 'Other',
          tags: ['admin'],
        },
      },
      rounds: {
        round_1: { createdAt: '2025-10-05T00:00:00.000Z', driverId: 'drv_1', status: 'done' },
        round_2: { createdAt: '2025-10-06T00:00:00.000Z', driverId: 'drv_1', status: 'draft' },
        round_3: { createdAt: '2025-10-07T00:00:00.000Z', driverId: 'drv_2', status: 'done' },
      },
      teams: {
        team_1: { name: 'Orange' },
        team_2: { name: 'Blue' },
      },
      'events/evt_1/orders': {
        ord_1: { status: 'paid' },
      },
    },
  },
});

describe('FDQL executor', () => {
  it('streams rows and read stats for provider and local filters', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["firstName", "createdAt"])

from $drivers as d
fs where d.active = true
fs order by d.createdAt desc
fs limit 10
then filter lower(d.firstName) = "vini"
then take 25
return fs.id(d) as id, d.firstName`);

    expect(rows(events)).toEqual([{ firstName: 'Vini', id: 'drv_1' }]);
    expect(completed(events)).toMatchObject({
      reads: 2,
      rowsOutput: 1,
      rowsScanned: 2,
      stoppedReason: 'completed',
    });
  });

  it('emits provider-neutral row lineage', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", [])

from $drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d)`);

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'row',
        lineage: {
          provider: 'fs',
          readContribution: 1,
          rowPath: 'drivers/drv_1',
          source: '$drivers',
        },
      }),
    );
  });

  it('supports metadata-only reads', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", [])

from $drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d), fs.path(d) as path, d.firstName`);

    expect(rows(events)).toEqual([{ id: 'drv_1', path: 'drivers/drv_1' }]);
    expect(completed(events)).toMatchObject({ reads: 1, rowsOutput: 1 });
  });

  it('keeps nested field mask values nested', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["metadata.fraudScore"])

from $drivers as d
fs where fs.id(d) = "drv_1"
return d.metadata.fraudScore as fraudScore, d.firstName`);

    expect(rows(events)).toEqual([{ fraudScore: 0.02 }]);
  });

  it('reads collection groups', async () => {
    const events = await run(`alias $orders = fs.collectionGroup("orders", ["status"])

from $orders as o
fs limit 10
return fs.id(o) as id, o.status`);

    expect(rows(events)).toEqual([{ id: 'ord_1', status: 'paid' }]);
  });

  it('stops at the read budget without over-reading rows', async () => {
    const events = await run(`set readBudget = 1
alias $drivers = fs.collection("drivers", ["firstName"])

from $drivers as d
fs limit 10
return fs.id(d) as id, d.firstName`);

    expect(rows(events)).toEqual([{ firstName: 'Vini', id: 'drv_1' }]);
    expect(completed(events)).toMatchObject({
      reads: 1,
      rowsOutput: 1,
      rowsScanned: 1,
      stoppedReason: 'budget',
    });
  });

  it('emits cancelled when the signal is aborted', async () => {
    const result = compileFdqlRead(
      `set allowUnboundedReads = true
alias $drivers = fs.collection("drivers")
from $drivers as d
return d.firstName`,
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

  it('passes provider limits and field masks to the runtime', async () => {
    const requests: unknown[] = [];
    const collectingRuntime: FdqlProviderRuntimeRegistry = {
      dialects: { fs: firestoreProviderDialect },
      providers: {
        fs: {
          async *read(request) {
            requests.push(request);
            yield {
              context: { collectionPath: 'drivers', projectId: 'local' },
              data: { firstName: stringValue('Vini') },
              id: 'drv_1',
              path: 'drivers/drv_1',
              provider: 'fs',
              source: request.source,
            };
          },
        },
      },
    };

    await run(
      `alias $drivers = fs.collection("drivers", ["firstName"])
from $drivers as d
fs limit 1
return d.firstName`,
      collectingRuntime,
    );

    expect(requests).toEqual([
      expect.objectContaining({
        fieldMask: [{ path: 'firstName' }],
        limit: 1,
      }),
    ]);
  });

  it('attaches lookup one results and counts lookup reads', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["firstName", "teamId"])
alias $teams = fs.collection("teams", ["name"])

from $drivers as d
fs where fs.id(d) = "drv_1"

then lookup one $teams as team
  fs where fs.id(team) = d.teamId

return fs.id(d) as id, d.firstName, team.name as teamName`);

    expect(rows(events)).toEqual([{ firstName: 'Vini', id: 'drv_1', teamName: 'Orange' }]);
    expect(completed(events)).toMatchObject({
      lookupReads: 1,
      reads: 2,
      rowsOutput: 1,
      rowsScanned: 2,
    });
  });

  it('attaches lookup many arrays', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["firstName"])
alias $rounds = fs.collection("rounds", ["driverId", "status"])

from $drivers as d
fs where fs.id(d) = "drv_1"

then lookup many $rounds as rounds
  fs where rounds.driverId = fs.id(d)
  fs order by rounds.createdAt desc
  fs limit 2

return fs.id(d) as id, rounds`);

    expect(rows(events)).toEqual([
      {
        id: 'drv_1',
        rounds: [
          { driverId: 'drv_1', status: 'draft' },
          { driverId: 'drv_1', status: 'done' },
        ],
      },
    ]);
    expect(completed(events)).toMatchObject({ lookupReads: 2, reads: 3, rowsOutput: 1 });
  });

  it('unwinds array fields into separate rows', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["tags"])

from $drivers as d
fs limit 3

then unwind d.tags as tag

return fs.id(d) as id, tag`);

    expect(rows(events)).toEqual([
      { id: 'drv_1', tag: 'admin' },
      { id: 'drv_3', tag: 'admin' },
    ]);
    expect(completed(events)).toMatchObject({ reads: 3, rowsOutput: 2, rowsScanned: 3 });
  });

  it('unwinds map entries and reads dynamic map values', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["metadata"])

from $drivers as d
fs where fs.id(d) = "drv_1"

then unwind entries(d.metadata) as entry

return entry.key, entry.value, mapGet(d.metadata, entry.key) as dynamicValue`);

    expect(rows(events)).toEqual([
      { dynamicValue: 0.02, key: 'fraudScore', value: 0.02 },
      { dynamicValue: 'gold', key: 'tier', value: 'gold' },
    ]);
    expect(completed(events)).toMatchObject({ reads: 1, rowsOutput: 2 });
  });

  it('sorts local rows before returning them', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["firstName"])

from $drivers as d
fs limit 3

then sort by d.firstName asc

return fs.id(d) as id, d.firstName`);

    expect(rows(events)).toEqual([
      { firstName: 'Alex', id: 'drv_2' },
      { firstName: 'Vini', id: 'drv_1' },
      { firstName: 'Vini', id: 'drv_3' },
    ]);
  });

  it('aggregates bounded local rows', async () => {
    const events = await run(`alias $rounds = fs.collection("rounds", ["driverId", "createdAt"])

from $rounds as r
fs limit 10

then aggregate
  by r.driverId as driverId
  count() as total,
  max(r.createdAt) as lastRoundAt

return driverId, total, lastRoundAt`);

    expect(rows(events)).toEqual([
      { driverId: 'drv_1', lastRoundAt: '2025-10-06T00:00:00.000Z', total: 2 },
      { driverId: 'drv_2', lastRoundAt: '2025-10-07T00:00:00.000Z', total: 1 },
    ]);
    expect(completed(events)).toMatchObject({ aggregateSourceRows: 3, reads: 3, rowsOutput: 2 });
  });

  it('executes top-level union all branches with shared aliases', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers")
alias $teams = fs.collection("teams")

from $drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d) as id, "driver" as type

union all

from $teams as t
fs where fs.id(t) = "team_1"
return fs.id(t) as id, "team" as type`);

    expect(rows(events)).toEqual([
      { id: 'drv_1', type: 'driver' },
      { id: 'team_1', type: 'team' },
    ]);
    expect(completed(events)).toMatchObject({ reads: 2, rowsOutput: 2, unionBranches: 2 });
  });

  it('dispatches reads to a non-Firestore provider runtime', async () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem where p.active = true
mem limit 2
then filter lower(p.name) = "vini"
return mem.id(p), p.name`,
      { providers: [testProviderDialect] },
    );
    if (!result.ok) {
      throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
    }

    const events: FdqlExecutionEvent[] = [];
    for await (
      const event of executeFdql(
        result.plan,
        createTestProviderRuntime({
          people: {
            p1: { active: true, name: 'Vini' },
            p2: { active: true, name: 'Alex' },
          },
        }),
      )
    ) {
      events.push(event);
    }

    expect(rows(events)).toEqual([{ id: 'p1', name: 'Vini' }]);
    expect(completed(events)).toMatchObject({
      providerReads: { mem: 2 },
      reads: 2,
      rowsOutput: 1,
    });
  });

  it('fails when local equality compares provider values without equality keys', async () => {
    const events = await run(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
then filter d.ref = d.ref
return fs.id(d) as id`,
      {
        dialects: { fs: firestoreProviderDialect },
        providers: {
          fs: {
            async *read(request) {
              yield {
                context: { collectionPath: 'drivers', projectId: 'local' },
                data: {
                  ref: providerValue({
                    provider: 'fs',
                    value: { path: stringValue('drivers/d1') },
                    valueType: 'documentRef',
                  }),
                },
                id: 'drv_1',
                path: 'drivers/drv_1',
                provider: 'fs',
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
