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
