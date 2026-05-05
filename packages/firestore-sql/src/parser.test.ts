import { describe, expect, it } from 'vitest';
import { formatFirestoreSql, parseFirestoreSql } from './parser.ts';

const additionalSpecFixtures: readonly SpecExample[] = [
  {
    name: 'explicit project collection',
    sql: `select *
from project("prod").orders o
where o.status = "paid"`,
  },
  {
    name: 'explicit project subcollection path',
    sql: `select *
from project("prod").collection("customers/cus_123/orders") o`,
  },
  {
    name: 'cross-project join',
    sql: `select id(prod) as orderId, prod.status, stage.status as stagingStatus
from project("prod").orders prod
left join project("staging").orders stage on id(stage) = id(prod)`,
  },
  {
    name: 'document metadata',
    sql: `select id(o), path(o), ref(o), parent_path(o)
from orders o
where id(o) in ("ord_1024", "ord_1025")`,
  },
  {
    name: 'nested map field paths',
    sql: `select o.customer.email, o.shipping.address.city
from orders o
where o.customer.tier = "gold"`,
  },
  {
    name: 'quoted field path segments',
    sql: `select o.\`billing.total\`, o.\`created by\`
from orders o`,
  },
  {
    name: 'exists array subquery',
    sql: `select id(o)
from orders o
where exists (
  select 1
  from unnest(o.items) item
  where item.total > 1
)`,
  },
  {
    name: 'array item code subquery',
    sql: `select id(o)
from orders o
where exists (
  select 1
  from unnest(o.items) item
  where item.code in ("a1", "a2")
)`,
  },
  {
    name: 'array rows',
    sql: `select id(o), item.code, item.total
from orders o
cross join unnest(o.items) item
where item.total > 1`,
  },
  {
    name: 'map entry rows',
    sql: `select
  id(g) as gameId,
  key(r) as roundId,
  r.description
from games g
cross join entries(g.rounds) r`,
  },
  {
    name: 'map repeated id field',
    sql: `select
  id(g) as gameId,
  key(r) as roundKey,
  r.id as roundFieldId,
  r.description
from games g
cross join entries(g.rounds) r`,
  },
  {
    name: 'document id join',
    sql: `select id(o), u.email
from orders o
left join users u on id(u) = o.userId`,
  },
  {
    name: 'reference join',
    sql: `select id(o), u.email
from orders o
left join users u on ref(u) = o.userRef`,
  },
  {
    name: 'aggregation over join',
    sql: `select
  u.tier,
  count(*) as orders,
  sum(o.total) as revenue
from orders o
left join users u on id(u) = o.userId
where o.status = "paid"
group by u.tier
having count(*) > 10`,
  },
  {
    name: 'execution update',
    sql: `update project("staging").orders o
set archived = true
where o.status = "closed"
limit 1000
page size 100
write batch size 400`,
  },
  {
    name: 'execution insert select',
    sql: `insert into project("staging").archivedOrders(@id, sourceId, status)
on conflict fail
write batch size 400
select id(o), id(o), o.status
from project("prod").orders o
where o.status = "closed"
limit 1000
page size 100`,
  },
  {
    name: 'simple delete',
    sql: `delete from orders o
where o.status = "test"`,
  },
  {
    name: 'explicit subcollection delete',
    sql: `delete from collection("customers/cus_123/orders") o
where o.status = "test"`,
  },
  {
    name: 'cross-project delete',
    sql: `delete from project("staging").orders stage
using project("prod").orders prod
where id(stage) = id(prod)
  and prod.deleted = true`,
  },
  {
    name: 'simple update',
    sql: `update orders o
set
  archived = true,
  archivedAt = now()
where o.status = "closed"`,
  },
  {
    name: 'explicit subcollection update',
    sql: `update collection("customers/cus_123/orders") o
set
  archived = true,
  archivedAt = now()
where o.status = "closed"`,
  },
  {
    name: 'parameterized keyed map update',
    sql: `update games g
set
  field_path("rounds", $roundId, "description") = "changed"
where id(g) = "game_1"`,
  },
  {
    name: 'update from',
    sql: `update orders o
from users u
set
  customerEmail = u.email,
  customerTier = u.tier
where o.userId = id(u)`,
  },
  {
    name: 'dynamic subcollection update',
    sql: `update o
from customers c
cross join subcollection(c, "orders") o
set
  archived = true,
  archivedAt = now()
where c.disabled = true
  and o.status = "closed"`,
  },
  {
    name: 'cross-project insert values',
    sql: `insert into project("staging").tags(@id, name, kind)
on conflict fail
values ("vip", "VIP", "customer")`,
  },
  {
    name: 'insert from select',
    sql: `insert into archivedOrders(@id, sourceId, status, total, archivedAt)
on conflict fail
select
  id(o),
  id(o),
  o.status,
  o.total,
  now()
from orders o
where o.status = "closed"`,
  },
  {
    name: 'schema discovery script',
    sql: `discover schema for orders limit 500
discover schema for collection("customers/cus_123/orders") limit 500
discover schema for collection_group("orders") limit 1000
discover schema for project("prod").collection_group("orders") limit 1000
describe orders`,
  },
];

describe('Firestore SQL parser', () => {
  it.each(additionalSpecFixtures)('parses fixed spec fixture: $name', ({ sql }) => {
    expect(parseFirestoreSql(sql)).toMatchObject({ ok: true, diagnostics: [] });
  });

  it.each(additionalSpecFixtures)(
    'formats fixed spec fixture into canonical SQL that parses back: $name',
    ({ name, sql }) => {
      const parsed = parseFirestoreSql(sql);
      expect(parsed.ok, name).toBe(true);
      if (!parsed.ok) return;

      const formatted = formatFirestoreSql(parsed.ast);
      const reparsed = parseFirestoreSql(formatted);

      expect(reparsed.ok, formatted).toBe(true);
      if (!reparsed.ok) return;
      expect(reparsed.ast).toEqual(parsed.ast);
    },
  );

  it.each([
    [
      'root collection with order and limit',
      `select *
from orders o
where o.status = "paid"
order by o.createdAt desc
limit 100`,
      {
        execution: { limit: 100 },
        from: { alias: 'o', kind: 'collection', name: 'orders' },
        kind: 'select',
        orderBy: [{ direction: 'desc' }],
        where: { kind: 'binary', operator: '=' },
      },
    ],
    [
      'explicit collection path',
      `select *
from collection("customers/cus_123/orders") o
where o.status = "paid"`,
      {
        from: {
          alias: 'o',
          args: [{ kind: 'literal', value: 'customers/cus_123/orders' }],
          kind: 'function',
          name: 'collection',
        },
        kind: 'select',
      },
    ],
    [
      'collection group',
      `select *
from collection_group("orders") o
where o.status = "paid"`,
      {
        from: {
          alias: 'o',
          args: [{ kind: 'literal', value: 'orders' }],
          kind: 'function',
          name: 'collection_group',
        },
        kind: 'select',
      },
    ],
    [
      'project context alias',
      `select id(src) as orderId, src.status, dst.status as targetStatus
from project($source).orders src
left join project($target).orders dst on id(dst) = id(src)`,
      {
        from: {
          alias: 'src',
          kind: 'project',
          project: { kind: 'parameter', name: 'source' },
          source: { kind: 'collection', name: 'orders' },
        },
        joins: [
          {
            source: {
              alias: 'dst',
              kind: 'project',
              project: { kind: 'parameter', name: 'target' },
            },
            type: 'left',
          },
        ],
        kind: 'select',
      },
    ],
    [
      'explicit project collection group',
      `select *
from project("prod").collection_group("orders") o`,
      {
        from: {
          alias: 'o',
          kind: 'project',
          project: { kind: 'literal', value: 'prod' },
          source: { kind: 'function', name: 'collection_group' },
        },
        kind: 'select',
      },
    ],
  ])('parses source fixture: %s', (_name, sql, expected) => {
    expect(astOf(sql)).toMatchObject(expected);
  });

  it('parses direct subcollection discovery and dynamic subcollection sources', () => {
    const ast = astOf(
      `select path(c) as customerPath, id(sc) as collectionId, path(doc) as documentPath
from customers c
cross join subcollections(c) sc
cross join subcollection(c, id(sc)) doc`,
    );

    expect(ast).toMatchObject({
      from: { alias: 'c', kind: 'collection', name: 'customers' },
      joins: [
        { source: { alias: 'sc', kind: 'function', name: 'subcollections' }, type: 'cross' },
        { source: { alias: 'doc', kind: 'function', name: 'subcollection' }, type: 'cross' },
      ],
      kind: 'select',
    });
  });

  it('keeps id fields distinct from document id metadata functions', () => {
    const parsed = parseFirestoreSql(
      'select o.id, id(o) as documentId from orders o where id(o) = "ord_1"',
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ast).toMatchObject({
      columns: [
        { expression: { kind: 'fieldPath', parts: [{ text: 'o' }, { text: 'id' }] } },
        { alias: 'documentId', expression: { kind: 'call', name: 'id' } },
      ],
      kind: 'select',
      where: { kind: 'binary', left: { kind: 'call', name: 'id' } },
    });
  });

  it('parses typed Firestore literals and date helpers as expressions', () => {
    const ast = astOf(`select
  timestamp("2026-01-01T00:00:00Z") as createdAt,
  geopoint(-37.8136, 144.9631) as place,
  ref("users/u_123") as userRef,
  bytes_base64("SGVsbG8=") as bytes,
  vector([0.12, 0.48, 0.92]) as embedding,
  int(10) as retryCount,
  double(10) as score,
  date("2026-01-01") as day,
  now() as observedAt
from orders o
where o.createdAt >= timestamp("2026-01-01T00:00:00Z")`);

    expect(ast).toMatchObject({
      columns: [
        { expression: { kind: 'call', name: 'timestamp' } },
        {
          expression: {
            args: [
              {
                expression: { kind: 'literal', value: 37.8136, valueType: 'number' },
                kind: 'unary',
                operator: '-',
              },
              { kind: 'literal', value: 144.9631, valueType: 'number' },
            ],
            kind: 'call',
            name: 'geopoint',
          },
        },
        { expression: { kind: 'call', name: 'ref' } },
        { expression: { kind: 'call', name: 'bytes_base64' } },
        {
          expression: {
            args: [{ items: [{ value: 0.12 }, { value: 0.48 }, { value: 0.92 }], kind: 'array' }],
            kind: 'call',
            name: 'vector',
          },
        },
        { expression: { kind: 'call', name: 'int' } },
        { expression: { kind: 'call', name: 'double' } },
        { expression: { kind: 'call', name: 'date' } },
        { expression: { kind: 'call', name: 'now' } },
      ],
      kind: 'select',
      where: { kind: 'binary', operator: '>=' },
    });
  });

  it('parses null, missing, membership, and array operators', () => {
    const ast = astOf(`select id(o)
from orders o
where o.deletedAt is null
  or o.status not in ("draft", "test")
  or exists(o.customer.email)
  or missing(o.customer.phone)
  or array_contains(o.tags, "vip")
  or array_contains_any(o.tags, ("vip", "trial"))`);

    expect(ast).toMatchObject({
      kind: 'select',
      where: {
        kind: 'binary',
        operator: 'or',
      },
    });
    expect(formatFirestoreSql(ast)).toContain('array_contains_any(o.tags, ("vip", "trial"))');
  });

  it('parses local array subqueries and map entry expansion', () => {
    const arrayAst = astOf(`select id(o)
from orders o
where not exists (
  select 1
  from unnest(o.items) item
  where item.qty <= 0
)`);
    const mapAst = astOf(`select id(g), key(r), value(r)
from games g
left join entries(g.rounds) r
where key(r) in ("id-1", "id-2")`);

    expect(arrayAst).toMatchObject({
      kind: 'select',
      where: {
        kind: 'existsSubquery',
        negated: true,
        subquery: { from: { kind: 'function', name: 'unnest' } },
      },
    });
    expect(mapAst).toMatchObject({
      joins: [{ source: { kind: 'function', name: 'entries' }, type: 'left' }],
      kind: 'select',
      where: { kind: 'binary', left: { kind: 'call', name: 'key' }, operator: 'in' },
    });
  });

  it('parses computed fields, case expressions, and aggregates', () => {
    const computed = astOf(`select
  id(o) as orderId,
  o.total * 1.1 as totalWithTax,
  coalesce(o.customer.email, "unknown") as customerEmail,
  case when o.total >= 100 then "high" else "normal" end as valueBand
from orders o`);
    const aggregate = astOf(`select
  o.status,
  count(*) as orders,
  sum(o.total) as revenue,
  avg(o.total) as avgOrder,
  count(distinct o.customerId) as customers
from orders o
where o.createdAt >= timestamp("2026-01-01T00:00:00Z")
group by o.status
having count(*) > 10`);

    expect(computed).toMatchObject({
      columns: [
        { expression: { kind: 'call', name: 'id' } },
        { expression: { kind: 'binary', operator: '*' } },
        { expression: { kind: 'call', name: 'coalesce' } },
        { expression: { cases: [{ result: { value: 'high' } }], kind: 'case' } },
      ],
      kind: 'select',
    });
    expect(aggregate).toMatchObject({
      columns: [
        {},
        { expression: { args: [{ kind: 'wildcard' }], kind: 'call', name: 'count' } },
        { expression: { kind: 'call', name: 'sum' } },
        { expression: { kind: 'call', name: 'avg' } },
        { expression: { distinct: true, kind: 'call', name: 'count' } },
      ],
      groupBy: [{ kind: 'fieldPath' }],
      having: { kind: 'binary', operator: '>' },
      kind: 'select',
    });
  });

  it('parses join variants from the spec', () => {
    const ast = astOf(`select id(o), u.email, p.status
from orders o
inner join users u on u.companyId = o.companyId and u.email = o.customerEmail
left join collection_group("payments") p on p.orderId = id(o)`);

    expect(ast).toMatchObject({
      joins: [
        {
          condition: { kind: 'binary', operator: 'and' },
          source: { name: 'users' },
          type: 'inner',
        },
        {
          condition: { kind: 'binary', operator: '=' },
          source: { kind: 'function', name: 'collection_group' },
          type: 'left',
        },
      ],
      kind: 'select',
    });
  });

  it('parses delete using joins after the using source', () => {
    const ast = astOf(`delete from orders o
using users u
inner join companies c on c.id = u.companyId
where o.userId = id(u)
  and c.disabled = true`);

    expect(ast).toMatchObject({
      kind: 'delete',
      using: {
        joins: [
          {
            condition: { kind: 'binary', operator: '=' },
            source: { alias: 'c', name: 'companies' },
            type: 'inner',
          },
        ],
        source: { alias: 'u', name: 'users' },
      },
      where: { kind: 'binary', operator: 'and' },
    });
  });

  it('parses top-level union all and recursive CTE syntax', () => {
    const union = astOf(`select id(o) as orderId, o.status, "prod" as source
from project("prod").orders o
where o.status = "paid"
union all
select id(o) as orderId, o.status, "staging" as source
from project("staging").orders o
where o.status = "paid"`);
    const recursive = astOf(`with recursive tree(accountId, accountPath, depth) as (
  select id(a), path(a), 0
  from accounts a
  where id(a) = "root"
  union all
  select id(child), path(child), tree.depth + 1
  from tree
  join accounts child on child.parentId = tree.accountId
  where tree.depth < 5
)
select *
from tree`);

    expect(union).toMatchObject({
      branches: [
        { from: { project: { value: 'prod' } }, kind: 'select' },
        { from: { project: { value: 'staging' } }, kind: 'select' },
      ],
      kind: 'unionAll',
    });
    expect(recursive).toMatchObject({
      cte: {
        columns: ['accountId', 'accountPath', 'depth'],
        name: 'tree',
        query: { branches: [{ kind: 'select' }, { kind: 'select' }], kind: 'unionAll' },
      },
      kind: 'recursiveCte',
      query: { from: { name: 'tree' }, kind: 'select' },
    });
  });

  it('formats expressions with grouping needed to preserve the parsed AST', () => {
    const parsed = parseFirestoreSql(`select id(o)
from orders o
where (o.status = "paid" or o.status = "refunded")
  and not (o.deleted = true or missing(o.deleted))`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const formatted = formatFirestoreSql(parsed.ast);
    const reparsed = parseFirestoreSql(formatted);

    expect(formatted).toBe(
      'select id(o) from orders o where (o.status = "paid" or o.status = "refunded") and not (o.deleted = true or missing(o.deleted))',
    );
    expect(reparsed.ok, formatted).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.ast).toEqual(parsed.ast);
  });

  it('parses statement-level execution clauses', () => {
    const select = astOf(`select *
from orders o
where o.status = "paid"
limit 500
page size 100`);
    const write = astOf(`delete from project("staging").orders o
where o.status = "test"
limit 1000
page size 100
write batch size 400
write mode bulk_writer`);

    expect(select).toMatchObject({
      execution: { limit: 500, pageSize: 100 },
      kind: 'select',
    });
    expect(write).toMatchObject({
      execution: {
        limit: 1000,
        pageSize: 100,
        writeBatchSize: 400,
        writeMode: 'bulk_writer',
      },
      kind: 'delete',
    });
  });

  it.each([
    [
      'delete using join filter',
      `delete from orders o
using users u
where o.userId = id(u)
  and u.disabled = true`,
      {
        from: { alias: 'o', name: 'orders' },
        kind: 'delete',
        using: { source: { alias: 'u', name: 'users' } },
        where: { kind: 'binary', operator: 'and' },
      },
    ],
    [
      'delete dynamic subcollection alias',
      `delete o
from customers c
cross join subcollection(c, "orders") o
where c.disabled = true
  and o.status = "test"`,
      {
        joins: [{ source: { alias: 'o', kind: 'function', name: 'subcollection' }, type: 'cross' }],
        kind: 'delete',
        targetAlias: 'o',
      },
    ],
    [
      'update write helpers',
      `update orders o
set
  updatedAt = server_timestamp(),
  retryCount = increment(1),
  tags = array_union("archived"),
  staleTag = array_remove("active"),
  temporaryNote = delete_field()
where o.status = "closed"`,
      {
        kind: 'update',
        set: [
          { value: { kind: 'call', name: 'server_timestamp' } },
          { value: { kind: 'call', name: 'increment' } },
          { value: { kind: 'call', name: 'array_union' } },
          { value: { kind: 'call', name: 'array_remove' } },
          { value: { kind: 'call', name: 'delete_field' } },
        ],
      },
    ],
    [
      'update static keyed map field',
      `update games g
set
  rounds.\`id-1\`.description = "changed"
where id(g) = "game_1"`,
      {
        kind: 'update',
        set: [
          {
            target: {
              kind: 'fieldPath',
              parts: [{ text: 'rounds' }, { quoted: true, text: 'id-1' }, { text: 'description' }],
            },
          },
        ],
      },
    ],
    [
      'update entry-driven keyed map field',
      `update g
from games g
cross join entries(g.rounds) r
set
  field_path("rounds", key(r), "description") = "changed"
where id(g) = "game_1"
  and key(r) in ("id-1", "id-2")`,
      {
        from: { joins: [{ source: { kind: 'function', name: 'entries' } }] },
        kind: 'update',
        target: { kind: 'targetAlias', name: 'g' },
      },
    ],
    [
      'cross-project update from',
      `update project("staging").orders stage
from project("prod").orders prod
set
  copiedStatus = prod.status,
  copiedAt = now()
where id(stage) = id(prod)
limit 1000
page size 100
write batch size 400`,
      {
        execution: { limit: 1000, pageSize: 100, writeBatchSize: 400 },
        from: { source: { kind: 'project', project: { value: 'prod' } } },
        kind: 'update',
        target: { kind: 'project', project: { value: 'staging' } },
      },
    ],
    [
      'insert values with explicit id',
      `insert into tags(@id, name, kind)
on conflict fail
values ("vip", "VIP", "customer")`,
      {
        conflict: 'fail',
        kind: 'insert',
        targets: [{ kind: 'documentId' }, { name: 'name' }, { name: 'kind' }],
        values: [{ value: 'vip' }, { value: 'VIP' }, { value: 'customer' }],
      },
    ],
    [
      'insert values with generated id',
      `insert into tags(name, kind)
values ("VIP", "customer")`,
      {
        kind: 'insert',
        targets: [{ kind: 'field', name: 'name' }, { kind: 'field', name: 'kind' }],
        values: [{ value: 'VIP' }, { value: 'customer' }],
      },
    ],
    [
      'cross-project insert from select',
      `insert into project("staging").archivedOrders(@id, sourceId, status, total, archivedAt)
on conflict fail
write batch size 400
select
  id(o),
  id(o),
  o.status,
  o.total,
  now()
from project("prod").orders o
where o.status = "closed"
limit 1000
page size 100`,
      {
        conflict: 'fail',
        execution: { writeBatchSize: 400 },
        kind: 'insert',
        source: { execution: { limit: 1000, pageSize: 100 }, from: { kind: 'project' } },
        target: { kind: 'project', project: { value: 'staging' } },
      },
    ],
  ])('parses write fixture: %s', (_name, sql, expected) => {
    expect(astOf(sql)).toMatchObject(expected);
  });

  it('maps positional @id insert targets to document id input expressions', () => {
    const parsed = parseFirestoreSql(
      'insert into project("staging").archivedOrders(@id, sourceId, status) on conflict fail select id(o), id(o), o.status from project("prod").orders o',
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ast).toMatchObject({
      kind: 'insert',
      targets: [
        { kind: 'documentId' },
        { kind: 'field', name: 'sourceId' },
        { kind: 'field', name: 'status' },
      ],
    });
  });

  it('parses schema discovery command scripts from the spec', () => {
    const ast = astOf(`discover schema for orders limit 500
discover schema for collection("customers/cus_123/orders") limit 500
discover schema for collection_group("orders") limit 1000
discover schema for project("prod").collection_group("orders") limit 1000
describe orders`);

    expect(ast).toMatchObject({
      kind: 'script',
      statements: [
        { kind: 'discoverSchema', limit: 500, source: { kind: 'collection', name: 'orders' } },
        { kind: 'discoverSchema', limit: 500, source: { kind: 'function', name: 'collection' } },
        {
          kind: 'discoverSchema',
          limit: 1000,
          source: { kind: 'function', name: 'collection_group' },
        },
        { kind: 'discoverSchema', limit: 1000, source: { kind: 'project' } },
        { kind: 'describe', source: { kind: 'collection', name: 'orders' } },
      ],
    });
  });

  it('treats keywords as case-insensitive while preserving identifiers and canonicalizing strings', () => {
    const ast = astOf(`-- ignored
SELECT ID(OrderDoc) as OrderId
FROM Project($Source).Orders OrderDoc
WHERE OrderDoc.status = 'paid' /* ignored */`);
    const formatted = formatFirestoreSql(ast);

    expect(ast).toMatchObject({
      columns: [{ alias: 'OrderId', expression: { kind: 'call', name: 'ID' } }],
      from: {
        alias: 'OrderDoc',
        kind: 'project',
        project: { kind: 'parameter', name: 'Source' },
        source: { name: 'Orders' },
      },
      kind: 'select',
    });
    expect(formatted).toBe(
      'select ID(OrderDoc) as OrderId from project($Source).Orders OrderDoc where OrderDoc.status = "paid"',
    );
  });

  it.each([
    ['@id outside insert target', 'select @id from orders', 'UNEXPECTED_TOKEN'],
    ['@id in update assignment', 'update orders o set @id = "ord_1"', 'UNEXPECTED_TOKEN'],
    [
      'target/value count mismatch',
      'insert into tags(@id, name) on conflict fail values ("vip")',
      'INSERT_TARGET_VALUE_COUNT',
    ],
    [
      'target/select count mismatch',
      'insert into tags(@id, name) on conflict fail select id(o) from orders o',
      'INSERT_TARGET_VALUE_COUNT',
    ],
    [
      'non-top-level union all',
      'select * from (select * from orders union all select * from archivedOrders) x',
      'UNEXPECTED_TOKEN',
    ],
    [
      'plain union distinct',
      'select * from orders union select * from archivedOrders',
      'UNEXPECTED_TOKEN',
    ],
    [
      'union all branch column mismatch',
      'select id(o), o.status from orders o union all select id(o) from archivedOrders o',
      'UNION_BRANCH_COLUMN_COUNT',
    ],
    [
      'non-top-level union all in exists',
      'select id(o) from orders o where exists (select 1 from unnest(o.items) item union all select 1 from unnest(o.discounts) discount)',
      'UNEXPECTED_TOKEN',
    ],
    [
      'explicit @id insert without conflict policy',
      'insert into tags(@id, name) values ("vip", "VIP")',
      'INSERT_EXPLICIT_ID_CONFLICT_POLICY',
    ],
    [
      'explicit @id insert select without conflict policy',
      'insert into archivedOrders(@id, status) select id(o), o.status from orders o',
      'INSERT_EXPLICIT_ID_CONFLICT_POLICY',
    ],
    [
      'malformed execution clause placement',
      'select * from orders write batch size 10 where status = "paid"',
      'UNEXPECTED_TOKEN',
    ],
    [
      'pagination on insert values',
      'insert into tags(name) page size 100 values ("VIP")',
      'UNEXPECTED_TOKEN',
    ],
    [
      'order by after execution clause',
      'select * from orders limit 10 order by createdAt desc',
      'UNEXPECTED_TOKEN',
    ],
    [
      'command-session defaults are not SQL',
      'read_budget = 5000\npage_size = 100',
      'UNEXPECTED_TOKEN',
    ],
  ])('rejects %s', (_name, sql, code) => {
    const result = parseFirestoreSql(sql);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe(code);
  });
});

interface SpecExample {
  readonly name: string;
  readonly sql: string;
}

function astOf(sql: string) {
  const result = parseFirestoreSql(sql);

  expect(result, sql).toMatchObject({ ok: true, diagnostics: [] });
  if (!result.ok) throw new Error('Expected SQL to parse.');
  return result.ast;
}
