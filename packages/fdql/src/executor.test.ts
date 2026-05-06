import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from './compiler.ts';
import { createInMemoryFdqlRuntime, executeFdql } from './executor.ts';
import type { FdqlExecutionEvent, FdqlRuntime } from './types.ts';

const runtime = createInMemoryFdqlRuntime({
  projects: {
    local: {
      drivers: {
        drv_1: {
          active: true,
          createdAt: '2025-10-01T00:00:00.000Z',
          firstName: 'Vini',
          lastName: 'Carneiro',
          metadata: { fraudScore: 0.02 },
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
  it('streams rows and read stats for native and local filters', async () => {
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

  it('supports metadata-only reads', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", [])

from $drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d) as id, fs.path(d) as path, d.firstName`);

    expect(rows(events)).toEqual([{ firstName: undefined, id: 'drv_1', path: 'drivers/drv_1' }]);
    expect(completed(events)).toMatchObject({ reads: 1, rowsOutput: 1 });
  });

  it('keeps nested field mask values nested', async () => {
    const events = await run(`alias $drivers = fs.collection("drivers", ["metadata.fraudScore"])

from $drivers as d
fs where fs.id(d) = "drv_1"
return d.metadata.fraudScore as fraudScore, d.firstName`);

    expect(rows(events)).toEqual([{ firstName: undefined, fraudScore: 0.02 }]);
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
      { defaultProjectId: 'local' },
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

  it('passes native limits and field masks to the runtime', async () => {
    const requests: unknown[] = [];
    const collectingRuntime: FdqlRuntime = {
      async *read(request) {
        requests.push(request);
        yield {
          collectionPath: 'drivers',
          data: { firstName: 'Vini' },
          id: 'drv_1',
          path: 'drivers/drv_1',
          projectId: 'local',
        };
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
          expect.objectContaining({ data: { driverId: 'drv_1', status: 'draft' }, id: 'round_2' }),
          expect.objectContaining({ data: { driverId: 'drv_1', status: 'done' }, id: 'round_1' }),
        ],
      },
    ]);
    expect(completed(events)).toMatchObject({ lookupReads: 2, reads: 3, rowsOutput: 1 });
  });
});

async function run(
  source: string,
  selectedRuntime = runtime,
): Promise<readonly FdqlExecutionEvent[]> {
  const result = compileFdqlRead(source, { defaultProjectId: 'local' });
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
