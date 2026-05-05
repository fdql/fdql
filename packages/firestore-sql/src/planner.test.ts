import { describe, expect, it } from 'vitest';
import { analyzeFirestoreSql } from './analyzer.ts';
import { parseFirestoreSql } from './parser.ts';
import { planFirestoreSql } from './planner.ts';

const context = {
  defaultProjectId: 'local',
  executionDefaults: {
    pageSize: 50,
    writeBatchSize: 300,
    writeMode: 'batch' as const,
  },
  projectAliases: {
    prod: 'prod-project',
    staging: 'staging-project',
  },
};

describe('Firestore SQL planner', () => {
  it('plans a simple select read and projection', () => {
    expect(plan('select * from orders o')).toMatchObject({
      ok: true,
      plan: {
        kind: 'select',
        stages: [
          { execution: { pageSize: 50 }, kind: 'execution' },
          {
            kind: 'read',
            source: {
              alias: 'o',
              classification: 'native',
              collectionPath: 'orders',
              projectId: 'local',
            },
          },
          { columnCount: 1, computed: false, kind: 'project' },
        ],
      },
    });
  });

  it('plans native-looking filter and statement execution overrides', () => {
    expectPlanStages(
      `select *
from orders o
where o.status = "paid"
order by o.createdAt desc
limit 100
page size 25`,
      [
        { execution: { limit: 100, pageSize: 25 }, kind: 'execution' },
        { kind: 'read' },
        { classification: 'native', kind: 'filter' },
        { kind: 'project' },
      ],
    );
  });

  it('plans local computed projections', () => {
    expectPlanStages(
      `select id(o) as orderId, o.total * 1.1 as totalWithTax
from orders o`,
      [
        { kind: 'execution' },
        { kind: 'read' },
        { columnCount: 2, computed: true, kind: 'project' },
      ],
    );
  });

  it('plans joins with source metadata', () => {
    expectPlanStages(
      `select id(o), u.email
from orders o
left join project("prod").users u on id(u) = o.userId`,
      [
        { kind: 'execution' },
        { kind: 'read', source: { alias: 'o', collectionPath: 'orders', projectId: 'local' } },
        {
          kind: 'join',
          source: { alias: 'u', collectionPath: 'users', projectId: 'prod' },
          type: 'left',
        },
        { kind: 'project' },
      ],
    );
  });

  it('plans union branches independently', () => {
    expectPlanStages(
      `select id(o), "prod" as source
from project($prod).orders o
union all
select id(o), "staging" as source
from project($staging).orders o`,
      [
        {
          branchIndex: 0,
          kind: 'unionBranch',
          stages: [
            { kind: 'execution' },
            { kind: 'read', source: { projectId: 'prod-project' } },
            { kind: 'project' },
          ],
        },
        {
          branchIndex: 1,
          kind: 'unionBranch',
          stages: [
            { kind: 'execution' },
            { kind: 'read', source: { projectId: 'staging-project' } },
            { kind: 'project' },
          ],
        },
      ],
    );
  });

  it('plans delete writes', () => {
    expectPlanStages(
      `delete from orders o
where o.status = "test"
limit 10`,
      [
        { execution: { limit: 10 }, kind: 'execution' },
        { kind: 'read' },
        { kind: 'filter' },
        { kind: 'write', operation: 'delete', target: { collectionPath: 'orders' } },
      ],
    );
  });

  it('plans update writes', () => {
    expectPlanStages(
      `update project("staging").orders o
set archived = true
where o.status = "closed"`,
      [
        { kind: 'execution' },
        { kind: 'read', source: { projectId: 'staging', collectionPath: 'orders' } },
        { kind: 'filter' },
        { kind: 'write', operation: 'update', target: { projectId: 'staging' }, writeCount: 1 },
      ],
    );
  });

  it('plans insert values writes', () => {
    expectPlanStages('insert into tags(name, kind) values ("VIP", "customer")', [
      { kind: 'execution' },
      { kind: 'write', operation: 'insert', target: { collectionPath: 'tags' }, writeCount: 2 },
    ]);
  });

  it('plans insert select writes after source stages', () => {
    expectPlanStages(
      `insert into archivedOrders(@id, sourceId, status)
on conflict fail
write batch size 400
select id(o), id(o), o.status
from orders o
where o.status = "closed"
limit 100`,
      [
        { execution: { writeBatchSize: 400 }, kind: 'execution' },
        { execution: { limit: 100, pageSize: 50 }, kind: 'execution' },
        { kind: 'read', source: { collectionPath: 'orders' } },
        { kind: 'filter' },
        { kind: 'project' },
        { kind: 'write', operation: 'insert', target: { collectionPath: 'archivedOrders' } },
      ],
    );
  });

  it('returns a warning plan for recursive CTEs', () => {
    expectPlan(
      `with recursive tree(id, depth) as (
  select id(a), 0 from accounts a where id(a) = "root"
  union all
  select id(child), tree.depth + 1 from tree join accounts child on child.parentId = tree.id
)
select * from tree`,
      {
        diagnostics: [{ code: 'UNSUPPORTED_RECURSIVE_CTE', severity: 'warning' }],
        ok: true,
        plan: { kind: 'recursiveCte', stages: [] },
      },
    );
  });
});

function expectPlan(sql: string, expected: object): void {
  expect(plan(sql)).toMatchObject(expected);
}

function expectPlanStages(sql: string, expected: readonly object[]): void {
  expect(plan(sql).plan?.stages).toMatchObject(expected);
}

function plan(sql: string) {
  const parsed = parseFirestoreSql(sql);
  expect(parsed, sql).toMatchObject({ ok: true, diagnostics: [] });
  if (!parsed.ok) throw new Error('Expected SQL to parse.');

  const analysis = analyzeFirestoreSql(parsed.ast, context);
  expect(analysis, sql).toMatchObject({ ok: true });

  return planFirestoreSql(parsed.ast, analysis, context);
}
