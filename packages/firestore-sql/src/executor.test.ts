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
  projectAliases: {
    prod: 'prod-project',
    staging: 'staging-project',
  },
};

describe('Firestore SQL mock executor', () => {
  it('streams rows for select star', async () => {
    const events = await execute('select * from orders o');

    expect(rows(events)).toEqual([
      { status: 'paid', total: 125, userId: 'usr_1' },
      { status: 'test', total: 5, userId: 'usr_2' },
      { status: 'paid', total: 80, userId: 'missing' },
    ]);
    expect(completed(events)).toMatchObject({
      reads: 3,
      rowsOutput: 3,
      rowsScanned: 3,
    });
  });

  it('filters with comparisons and boolean expressions', async () => {
    const events = await execute(`select id(o) as orderId
from orders o
where o.status = "paid" and (o.total > 100 or o.userId = "missing")`);

    expect(rows(events)).toEqual([{ orderId: 'ord_1024' }, { orderId: 'ord_1026' }]);
  });

  it('honors limit clauses', async () => {
    const events = await execute('select id(o) as orderId from orders o limit 1');

    expect(rows(events)).toEqual([{ orderId: 'ord_1024' }]);
    expect(completed(events)).toMatchObject({ rowsOutput: 1 });
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

  it('tracks cross-project reads', async () => {
    const events = await execute('select id(o) as orderId from project($prod).orders o');

    expect(rows(events)).toEqual([{ orderId: 'prod_900' }, { orderId: 'prod_901' }]);
    expect(completed(events)).toMatchObject({
      perProjectReads: { 'prod-project': 2 },
      reads: 2,
    });
  });

  it('deletes matching in-memory fixture documents', async () => {
    const runtime = createRuntime();
    const events = await execute('delete from orders o where o.status = "test"', runtime);

    expect(runtime.projects.local?.orders).not.toHaveProperty('ord_1025');
    expect(completed(events)).toMatchObject({ rowsScanned: 3, writes: 1 });
  });

  it('updates matching in-memory fixture documents', async () => {
    const runtime = createRuntime();
    const events = await execute(
      'update orders o set archived = true where id(o) = "ord_1024"',
      runtime,
    );

    expect(runtime.projects.local?.orders?.ord_1024).toMatchObject({ archived: true });
    expect(completed(events)).toMatchObject({ writes: 1 });
  });

  it('inserts values into in-memory fixture collections', async () => {
    const runtime = createRuntime();
    const events = await execute(
      'insert into tags(@id, name, kind) on conflict fail values ("tag_vip", "VIP", "customer")',
      runtime,
    );

    expect(runtime.projects.local?.tags?.tag_vip).toEqual({ kind: 'customer', name: 'VIP' });
    expect(completed(events)).toMatchObject({ writes: 1 });
  });

  it('emits failed for unsupported planned stages', async () => {
    const events = await execute('select count(*) as total from orders o');

    expect(events).toContainEqual({
      diagnostic: {
        code: 'UNSUPPORTED_EXECUTION_STAGE',
        message: 'aggregate stages are not executable by the mock executor yet.',
        severity: 'error',
      },
      kind: 'failed',
    });
  });
});

async function execute(
  sql: string,
  runtime: InMemoryFirestoreSqlRuntime = createRuntime(),
): Promise<readonly ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executeFirestoreSql(plan(sql), runtime)) {
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

function rows(events: readonly ExecutionEvent[]): readonly Record<string, unknown>[] {
  return events.flatMap((event) => event.kind === 'row' ? [event.row] : []);
}

function completed(events: readonly ExecutionEvent[]) {
  const event = events.find((item) => item.kind === 'completed');
  expect(event).toBeDefined();
  if (!event || event.kind !== 'completed') throw new Error('Expected completed event.');
  return event.stats;
}

function createRuntime(): InMemoryFirestoreSqlRuntime {
  return {
    projects: {
      local: {
        orders: {
          ord_1024: { status: 'paid', total: 125, userId: 'usr_1' },
          ord_1025: { status: 'test', total: 5, userId: 'usr_2' },
          ord_1026: { status: 'paid', total: 80, userId: 'missing' },
        },
        tags: {},
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
