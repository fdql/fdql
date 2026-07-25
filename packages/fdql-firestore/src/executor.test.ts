import { compileFdqlRead, executeFdql } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { firestoreProviderDialect } from './fs-dialect.ts';
import { createTestFirestoreRuntime } from './test-helpers/firestore-runtime.ts';

const options = {
  defaultProviderContext: { fs: { projectId: 'local' } },
  providers: [firestoreProviderDialect],
};

describe('Firestore FDQL subcollection execution', () => {
  it('reads static, dynamic, and template subcollection sources', async () => {
    const runtime = createTestFirestoreRuntime({
      projects: {
        local: {
          missingParents: {},
          orders: {
            ord_1: { status: 'paid' },
          },
          'orders/ord_1/items': {
            item_1: { status: 'picked' },
          },
        },
      },
    });

    const staticEvents = await execute(
      `alias $items = fs.subcollection("orders/ord_1", "items", ["status"])
from $items as item
fs limit 1
return fs.id(item) as id, item.status`,
      runtime,
    );
    const dynamicEvents = await execute(
      `alias $orders = fs.collection("orders", [])
from $orders as order
fs limit 1
then lookup many fs.subcollection(order, "items", ["status"]) as items
return fs.id(order) as orderId, items`,
      runtime,
    );
    const staticLookupEvents = await execute(
      `alias $orders = fs.collection("orders", [])
alias $items = fs.subcollection("orders/ord_1", "items", ["status"])
from $orders as order
fs limit 1
then lookup many $items as items
return fs.id(order) as orderId, items`,
      runtime,
    );
    const templateEvents = await execute(
      `alias $orders = fs.collection("orders", [])
alias $items = fs.subcollection("items", ["status"])
from $orders as order
fs limit 1
then lookup many $items of order as items
return fs.id(order) as orderId, items`,
      runtime,
    );

    expect(rows(staticEvents)).toEqual([{ id: 'item_1', status: 'picked' }]);
    expect(rows(dynamicEvents)).toEqual([
      {
        items: [{ status: 'picked' }],
        orderId: 'ord_1',
      },
    ]);
    expect(rows(staticLookupEvents)).toEqual(rows(dynamicEvents));
    expect(rows(templateEvents)).toEqual(rows(dynamicEvents));
  });

  it('keeps optional rows and drops required rows when parent is null', async () => {
    const runtime = createTestFirestoreRuntime({
      projects: {
        local: {
          orders: {
            ord_1: { status: 'paid' },
          },
        },
      },
    });

    const optionalEvents = await execute(
      `alias $orders = fs.collection("orders", [])
alias $parents = fs.collection("missingParents", [])
alias $items = fs.subcollection("items", ["status"])
from $orders as order
fs limit 1
then lookup one $parents as missingParent
  fs where fs.id(missingParent) = "none"
then lookup one $items of missingParent as item
return fs.id(order) as orderId, item.status`,
      runtime,
    );
    const requiredEvents = await execute(
      `alias $orders = fs.collection("orders", [])
alias $parents = fs.collection("missingParents", [])
alias $items = fs.subcollection("items", ["status"])
from $orders as order
fs limit 1
then lookup one $parents as missingParent
  fs where fs.id(missingParent) = "none"
then lookup required one $items of missingParent as item
return fs.id(order) as orderId, item.status`,
      runtime,
    );

    expect(rows(optionalEvents)).toEqual([{ orderId: 'ord_1' }]);
    expect(rows(requiredEvents)).toEqual([]);
    expect(completed(optionalEvents)).toMatchObject({ lookupReads: 0, reads: 1 });
    expect(completed(requiredEvents)).toMatchObject({ lookupReads: 0, reads: 1 });
  });

  it('runs provider aggregate stages with Firestore aggregate helpers', async () => {
    const runtime = createTestFirestoreRuntime({
      projects: {
        local: {
          drivers: {
            drv_1: { firstName: 'Vini' },
            drv_2: { firstName: 'Alex' },
          },
          rounds: {
            rnd_1: { createdAt: '2026-01-01T00:00:00.000Z', driverId: 'drv_1', points: 10 },
            rnd_2: { createdAt: '2026-02-01T00:00:00.000Z', driverId: 'drv_1', points: 20 },
          },
        },
      },
    });

    const events = await execute(
      `alias $drivers = fs.collection("drivers", ["firstName"])
alias $rounds = fs.collection("rounds", ["driverId", "points", "createdAt"])
from $drivers as d
fs limit 2
then fs.aggregate $rounds as round
  fs where round.driverId = fs.id(d)
  yield fs.count() as total, fs.sum(round.points) as points, fs.avg(round.points) as avgPoints, fs.max(round.createdAt) as lastRoundAt
return fs.id(d) as id, total, points, avgPoints, lastRoundAt`,
      runtime,
    );

    expect(rows(events)).toEqual([
      {
        avgPoints: 15,
        id: 'drv_1',
        lastRoundAt: '2026-02-01T00:00:00.000Z',
        points: 30,
        total: 2,
      },
      {
        avgPoints: null,
        id: 'drv_2',
        lastRoundAt: null,
        points: 0,
        total: 0,
      },
    ]);
    expect(completed(events)).toMatchObject({ aggregateReads: 2, lookupReads: 1, reads: 3 });
  });

  it('runs top-level aggregate sources', async () => {
    const runtime = createTestFirestoreRuntime({
      projects: {
        local: {
          rounds: {
            rnd_1: { active: true, createdAt: '2026-01-01T00:00:00.000Z', points: 10 },
            rnd_2: { active: true, createdAt: '2026-02-01T00:00:00.000Z', points: 20 },
            rnd_3: { active: false, createdAt: '2026-03-01T00:00:00.000Z', points: 99 },
          },
        },
      },
    });

    const countEvents = await execute(
      `alias $rounds = fs.collection("rounds", ["active"])
from fs.aggregate $rounds
  yield fs.count() as total
return total`,
      runtime,
    );
    const statsEvents = await execute(
      `alias $rounds = fs.collection("rounds", ["active", "points", "createdAt"])
from fs.aggregate $rounds as round
  fs where round.active = true
  yield fs.count() as total, fs.sum(round.points) as points, fs.avg(round.points) as avgPoints, fs.min(round.createdAt) as firstRoundAt, fs.max(round.createdAt) as lastRoundAt
return total, points, avgPoints, firstRoundAt, lastRoundAt`,
      runtime,
    );

    expect(rows(countEvents)).toEqual([{ total: 3 }]);
    expect(completed(countEvents)).toMatchObject({ aggregateReads: 1, reads: 0, rowsOutput: 1 });
    expect(rows(statsEvents)).toEqual([{
      avgPoints: 15,
      firstRoundAt: '2026-01-01T00:00:00.000Z',
      lastRoundAt: '2026-02-01T00:00:00.000Z',
      points: 30,
      total: 2,
    }]);
    expect(completed(statsEvents)).toMatchObject({
      aggregateReads: 1,
      reads: 1,
      rowsOutput: 1,
      rowsScanned: 1,
    });
  });

  it('runs static subcollection aggregate sources', async () => {
    const runtime = createTestFirestoreRuntime({
      projects: {
        local: {
          orders: {
            ord_1: { status: 'paid' },
          },
          'orders/ord_1/items': {
            item_1: { status: 'paid', total: 10 },
            item_2: { status: 'paid', total: 5 },
            item_3: { status: 'draft', total: 99 },
          },
        },
      },
    });

    const events = await execute(
      `alias $items = fs.subcollection("orders/ord_1", "items", ["status", "total"])
from fs.aggregate $items as item
  fs where item.status = "paid"
  yield fs.count() as total, fs.sum(item.total) as value
return total, value`,
      runtime,
    );

    expect(rows(events)).toEqual([{ total: 2, value: 15 }]);
    expect(completed(events)).toMatchObject({ aggregateReads: 1, reads: 0, rowsOutput: 1 });
  });
});

async function execute(
  source: string,
  runtime: ReturnType<typeof createTestFirestoreRuntime>,
) {
  const compiled = compileFdqlRead(source, options);
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const events = [];
  for await (const event of executeFdql(compiled.plan, runtime)) events.push(event);
  return events;
}

function rows(events: Awaited<ReturnType<typeof execute>>) {
  return events.flatMap((event) => event.kind === 'row' ? [event.row] : []);
}

function completed(events: Awaited<ReturnType<typeof execute>>) {
  return events.find((event) => event.kind === 'completed')?.stats;
}
