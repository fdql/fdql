import { describe, expect, it } from 'vitest';
import {
  analyzeFirestoreSql,
  executeFirestoreSql,
  type ExecutionEvent,
  type FirestoreSqlPlan,
  type InMemoryFirestoreSqlRuntime,
  parseFirestoreSql,
  planFirestoreSql,
} from './index.ts';

const context = {
  defaultProjectId: 'local',
  executionDefaults: {
    pageSize: 100,
    readBudget: 5000,
    timeoutMs: 60_000,
  },
  projectAliases: {
    prod: 'prod-project',
    staging: 'staging-project',
  },
};

describe('Firestore SQL read executor', () => {
  it('streams rows for select star', async () => {
    const events = await execute('select * from orders o');

    expect(rows(events)).toEqual([
      {
        items: [{ price: 100, sku: 'sku_keyboard' }, { price: 25, sku: 'sku_shipping' }],
        rounds: { round_1: { description: 'Packed' }, round_2: { description: 'Shipped' } },
        status: 'paid',
        total: 125,
        userId: 'usr_1',
      },
      {
        items: [{ price: 5, sku: 'sku_cable' }],
        rounds: {},
        status: 'test',
        total: 5,
        userId: 'usr_2',
      },
      { status: 'paid', total: 80, userId: 'missing' },
    ]);
    expect(completed(events)).toMatchObject({
      reads: 3,
      rowsOutput: 3,
      rowsScanned: 3,
    });
  });

  it('expands qualified wildcard projections', async () => {
    const events = await execute('select orders.* from orders');

    expect(rows(events)[0]).toEqual({
      items: [{ price: 100, sku: 'sku_keyboard' }, { price: 25, sku: 'sku_shipping' }],
      rounds: { round_1: { description: 'Packed' }, round_2: { description: 'Shipped' } },
      status: 'paid',
      total: 125,
      userId: 'usr_1',
    });
  });

  it('filters with comparisons, in, null checks, and boolean expressions', async () => {
    const events = await execute(`select id(o) as orderId
from orders o
where o.status in ("paid", "closed") and o.deletedAt is null and o.total >= 80`);

    expect(rows(events)).toEqual([{ orderId: 'ord_1024' }, { orderId: 'ord_1026' }]);
  });

  it('honors order and limit clauses', async () => {
    const events = await execute(`select id(o) as orderId, o.total as total
from orders o
order by o.total desc
limit 2`);

    expect(rows(events)).toEqual([
      { orderId: 'ord_1024', total: 125 },
      { orderId: 'ord_1026', total: 80 },
    ]);
    expect(completed(events)).toMatchObject({ rowsOutput: 2 });
  });

  it('projects metadata fields', async () => {
    const events = await execute(
      `select id(o) as docId, path(o) as docPath, project_id(o) as projectId
from project($prod).orders o`,
    );

    expect(rows(events)[0]).toEqual({
      docId: 'prod_900',
      docPath: 'orders/prod_900',
      projectId: 'prod-project',
    });
  });

  it('executes simple left joins by equality', async () => {
    const events = await execute(`select id(o) as orderId, u.email as email
from orders o
left join users u on id(u) = o.userId
where o.status = "paid"`);

    expect(rows(events)).toEqual([
      { email: 'ada@example.com', orderId: 'ord_1024' },
      { email: undefined, orderId: 'ord_1026' },
    ]);
    expect(completed(events)).toMatchObject({ joinMisses: 1 });
  });

  it('executes top-level union all with branch lineage', async () => {
    const events = await execute(`select id(o) as orderId, "local" as source
from orders o
where o.status = "test"
union all
select id(o) as orderId, "prod" as source
from project($prod).orders o`);

    expect(rows(events)).toEqual([
      { orderId: 'ord_1025', source: 'local' },
      { orderId: 'prod_900', source: 'prod' },
      { orderId: 'prod_901', source: 'prod' },
    ]);
    expect(rowEvents(events).map((event) => event.lineage.unionBranch)).toEqual([0, 1, 1]);
  });

  it('expands arrays with cross join unnest', async () => {
    const events = await execute(`select id(o) as orderId, item.sku as sku
from orders o
cross join unnest(o.items) item
where id(o) = "ord_1024"`);

    expect(rows(events)).toEqual([
      { orderId: 'ord_1024', sku: 'sku_keyboard' },
      { orderId: 'ord_1024', sku: 'sku_shipping' },
    ]);
  });

  it('expands maps with entries', async () => {
    const events = await execute(`select key(r) as roundId, r.description as description
from orders o
cross join entries(o.rounds) r
where id(o) = "ord_1024"`);

    expect(rows(events)).toEqual([
      { description: 'Packed', roundId: 'round_1' },
      { description: 'Shipped', roundId: 'round_2' },
    ]);
  });

  it('reads direct subcollections and collection groups', async () => {
    const subcollection = await execute(`select id(e) as eventId, e.type as type
from orders o
cross join subcollection(o, "events") e
where id(o) = "ord_1024"`);
    const collectionGroup = await execute(
      'select id(e) as eventId, path(e) as eventPath from collection_group("events") e',
    );

    expect(rows(subcollection)).toEqual([
      { eventId: 'evt_created', type: 'created' },
      { eventId: 'evt_paid', type: 'paid' },
    ]);
    expect(rows(collectionGroup)).toContainEqual({
      eventId: 'evt_paid',
      eventPath: 'orders/ord_1024/events/evt_paid',
    });
  });

  it('discovers direct subcollections', async () => {
    const events = await execute(`select id(sc) as id, path(sc) as path
from orders o
cross join subcollections(o) sc
where id(o) = "ord_1024"`);

    expect(rows(events)).toEqual([{ id: 'events', path: 'orders/ord_1024/events' }]);
  });

  it('stops with partial rows when read budget is reached', async () => {
    const events = await execute('select id(o) as orderId from orders o', createRuntime(), {
      readBudget: 2,
    });

    expect(rows(events)).toEqual([{ orderId: 'ord_1024' }, { orderId: 'ord_1025' }]);
    expect(completedEvent(events)?.stoppedReason).toBe('budget');
  });

  it('emits cancelled when the abort signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await execute('select id(o) as orderId from orders o', createRuntime(), {
      signal: controller.signal,
    });

    expect(events.map((event) => event.kind)).toContain('cancelled');
  });

  it('emits failed for unsupported aggregation', async () => {
    const events = await execute('select count(*) as total from orders o');

    expect(events).toContainEqual({
      diagnostic: {
        code: 'UNSUPPORTED_AGGREGATION',
        message: 'Aggregation is not supported in this read release.',
        severity: 'error',
      },
      kind: 'failed',
    });
  });
});

async function execute(
  sql: string,
  runtime: InMemoryFirestoreSqlRuntime = createRuntime(),
  options: Parameters<typeof executeFirestoreSql>[2] = {},
): Promise<readonly ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executeFirestoreSql(plan(sql), runtime, options)) {
    events.push(event);
  }
  return events;
}

function plan(sql: string): FirestoreSqlPlan {
  const parsed = parseFirestoreSql(sql);
  expect(parsed, sql).toMatchObject({ diagnostics: [], ok: true });
  if (!parsed.ok) throw new Error('Expected SQL to parse.');

  const analysis = analyzeFirestoreSql(parsed.ast, context);
  expect(analysis, sql).toMatchObject({ diagnostics: [], ok: true });

  const planned = planFirestoreSql(parsed.ast, analysis, context);
  expect(planned, sql).toMatchObject({ ok: true });
  if (!planned.plan) throw new Error('Expected SQL to plan.');
  return planned.plan;
}

function rowEvents(events: readonly ExecutionEvent[]) {
  return events.flatMap((event) => event.kind === 'row' ? [event] : []);
}

function rows(events: readonly ExecutionEvent[]): readonly Record<string, unknown>[] {
  return rowEvents(events).map((event) => event.row);
}

function completed(events: readonly ExecutionEvent[]) {
  const event = completedEvent(events);
  expect(event).toBeDefined();
  if (!event) throw new Error('Expected completed event.');
  return event.stats;
}

function completedEvent(events: readonly ExecutionEvent[]) {
  return events.find((item) => item.kind === 'completed');
}

function createRuntime(): InMemoryFirestoreSqlRuntime {
  return {
    projects: {
      local: {
        orders: {
          ord_1024: {
            items: [{ price: 100, sku: 'sku_keyboard' }, { price: 25, sku: 'sku_shipping' }],
            rounds: { round_1: { description: 'Packed' }, round_2: { description: 'Shipped' } },
            status: 'paid',
            total: 125,
            userId: 'usr_1',
          },
          ord_1025: {
            items: [{ price: 5, sku: 'sku_cable' }],
            rounds: {},
            status: 'test',
            total: 5,
            userId: 'usr_2',
          },
          ord_1026: { status: 'paid', total: 80, userId: 'missing' },
        },
        'orders/ord_1024/events': {
          evt_created: { type: 'created' },
          evt_paid: { type: 'paid' },
        },
        users: {
          usr_1: { email: 'ada@example.com', tier: 'gold' },
          usr_2: { email: 'grace@example.com', tier: 'silver' },
        },
      },
      'prod-project': {
        orders: {
          prod_900: { status: 'paid', total: 500, userId: 'usr_1' },
          prod_901: { status: 'closed', total: 200, userId: 'usr_3' },
        },
      },
      'staging-project': {},
    },
  };
}
