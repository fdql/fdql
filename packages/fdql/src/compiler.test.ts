import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from './compiler.ts';
import { firestoreProviderDialect } from './fs-dialect.ts';
import { testProviderDialect } from './test-helpers/provider.ts';

const options = {
  defaultProviderContext: { fs: { projectId: 'local' } },
  providers: [firestoreProviderDialect],
};

describe('FDQL compiler', () => {
  it('plans collection reads with field masks and provider clauses', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers", ["firstName", "lastName"])

from $drivers as d
fs where d.active = true
fs order by d.createdAt desc
fs limit 25
return fs.id(d) as id, d.firstName`,
      options,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          fieldMask: [{ path: 'firstName' }, { path: 'lastName' }],
          limit: 25,
          source: {
            provider: 'fs',
            sourceType: 'collection',
            target: { collectionPath: 'drivers', projectId: 'local' },
          },
        },
      },
    });
  });

  it('plans project and named database reads', () => {
    const result = compileFdqlRead(
      `alias $prod = "prod-project"
alias $drivers = fs.project($prod).db("db2").collection("drivers", [])

from $drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d) as id`,
      options,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          fieldMask: [],
          source: {
            provider: 'fs',
            target: { collectionPath: 'drivers', databaseId: 'db2', projectId: 'prod-project' },
          },
        },
      },
    });
  });

  it('rejects undeclared aliases', () => {
    const result = compileFdqlRead(
      `from $drivers as d
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNDECLARED_ALIAS' }),
    );
  });

  it('plans namespaced engine and provider settings', () => {
    const result = compileFdqlRead(
      `set fdql.readBudget = 7
set fdql.timeout = "2s"
set fdql.cache = "run"
set fdql.allowUnboundedReads = true
set fs.projectId = "query-project"
set fs.databaseId = "query-db"
alias $drivers = fs.collection("drivers")
from $drivers as d
return d.firstName`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          source: {
            target: {
              collectionPath: 'drivers',
              databaseId: 'query-db',
              projectId: 'query-project',
            },
          },
        },
        settings: {
          allowUnboundedReads: true,
          cache: 'run',
          readBudget: 7,
          timeoutMs: 2000,
        },
      },
    });
  });

  it('rejects unscoped set keys', () => {
    const result = compileFdqlRead(
      `set pageSize = 100
alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SET_KEY' }),
    );
  });

  it('rejects unknown namespaced set keys', () => {
    const result = compileFdqlRead(
      `set fdql.pageSize = 100
set fb.region = "us"
set fs.region = "us"
alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_UNKNOWN_SET_KEY', line: 1 }),
        expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 2 }),
        expect.objectContaining({ code: 'FDQL_UNKNOWN_SET_KEY', line: 3 }),
      ]),
    );
  });

  it('rejects duplicate set keys', () => {
    const result = compileFdqlRead(
      `set fdql.readBudget = 10
set fdql.readBudget = 20
alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_DUPLICATE_SET', line: 2 }),
    );
  });

  it('rejects set values that are not literals, arrays, or maps', () => {
    const result = compileFdqlRead(
      `set fdql.readBudget = count()
alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 1 }),
    );
  });

  it('rejects invalid read bounds', () => {
    const result = compileFdqlRead(
      `set fdql.readBudget = 0
set fdql.timeout = "soon"
alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 0
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 1 }),
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 2 }),
        expect.objectContaining({ code: 'FDQL_PARSE_ERROR' }),
      ]),
    );
  });

  it('rejects unqualified provider fields', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs where active = true
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNQUALIFIED_PROVIDER_FIELD' }),
    );
  });

  it('rejects invalid field masks', () => {
    const fields = Array.from({ length: 151 }, (_, index) => `"field${index}"`).join(', ');
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers", [${fields}])
from $drivers as d
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_FIELD_MASK' }),
    );
  });

  it('blocks unbounded provider reads by default', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNBOUNDED_PROVIDER_READ' }),
    );
  });

  it('rejects unsupported read stages', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
then lookup expand $drivers as other
  fs where other.teamId = d.teamId
return other.teamId`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_STAGE' }),
    );
  });

  it('plans unwind stages and local map helpers', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 10
then unwind entries(d.metadata) as entry
return entry.key, mapGet(d.metadata, entry.key) as value`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    if (result.plan.kind !== 'read') throw new Error('expected read plan');
    expect(result.plan.localStages).toContainEqual(
      expect.objectContaining({
        kind: 'unwind',
        rowAlias: 'entry',
      }),
    );
  });

  it('plans lookup one with correlated provider filters', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
alias $teams = fs.collection("teams", ["name"])
from $drivers as d
fs limit 10
then lookup one $teams as team
  fs where fs.id(team) = d.teamId
return d.firstName, team.name as teamName`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    if (result.plan.kind !== 'read') throw new Error('expected read plan');
    expect(result.plan.localStages[0]).toMatchObject({
      kind: 'lookup',
      mode: 'one',
      rowAlias: 'team',
      sourceAlias: '$teams',
    });
    const lookup = result.plan.localStages[0];
    if (!lookup || lookup.kind !== 'lookup') throw new Error('expected lookup stage');
    expect(lookup.provider).toMatchObject({
      fieldMask: [{ path: 'name' }],
      predicate: expect.objectContaining({ kind: 'binary' }),
      source: expect.objectContaining({
        provider: 'fs',
        target: expect.objectContaining({ collectionPath: 'teams' }),
      }),
    });
  });

  it('plans local sort and aggregate stages', () => {
    const result = compileFdqlRead(
      `alias $rounds = fs.collection("rounds")
from $rounds as r
fs limit 100
then sort by r.createdAt desc
then aggregate
  by r.driverId as driverId
  count() as total,
  max(r.createdAt) as lastRoundAt
return driverId, total, lastRoundAt`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    if (result.plan.kind !== 'read') throw new Error('expected read plan');
    expect(result.plan.localStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'sortBy' }),
        expect.objectContaining({ kind: 'aggregate' }),
      ]),
    );
  });

  it('plans top-level union all branches', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
alias $teams = fs.collection("teams")

from $drivers as d
fs limit 1
return fs.id(d) as id

union all

from $teams as t
fs limit 1
return fs.id(t) as id`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    expect(result.plan).toMatchObject({ branches: expect.any(Array), kind: 'union' });
  });

  it('rejects lookup predicates with unknown row bindings', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
alias $teams = fs.collection("teams")
from $drivers as d
fs limit 10
then lookup one $teams as team
  fs where fs.id(team) = missing.teamId
return team.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_BINDING', line: 6 }),
    );
  });

  it('rejects duplicate singleton provider stages', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs order by d.firstName asc
fs order by d.lastName asc
fs limit 1
fs limit 1
return fs.id(d) as id`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE', line: 4 }),
        expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE', line: 6 }),
      ]),
    );
  });

  it('rejects duplicate return stages', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return d.firstName
return d.lastName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE', line: 5 }),
    );
  });

  it('rejects unknown return function namespaces', () => {
    const result = compileFdqlRead(
      `set fdql.readBudget = 5000

alias $orders = fs.collection("public")
from $orders as o
fs limit 200
return fb.fgdfgf(o), o.type`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 6 }),
    );
  });

  it('rejects unknown provider namespaces', () => {
    const result = compileFdqlRead(
      `alias $orders = fb.collection("orders")
from $orders as o
fb limit 1
return o.type`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE' }),
    );
  });

  it('requires explicit providers', () => {
    const result = compileFdqlRead(
      `alias $orders = fs.collection("orders")
from $orders as o
fs limit 1
return o.type`,
      {},
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE' }),
    );
  });

  it('requires provider context for unqualified Firestore sources', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return d.firstName`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_MISSING_PROVIDER_CONTEXT' }),
    );
  });

  it('accepts explicit Firestore projects without provider context', () => {
    const result = compileFdqlRead(
      `set fs.projectId = "default"
set fs.databaseId = "default-db"
alias $drivers = fs.project("prod").db("db2").collection("drivers")
from $drivers as d
fs limit 1
return fs.id(d)`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          source: {
            target: { databaseId: 'db2', projectId: 'prod' },
          },
        },
      },
    });
  });

  it('plans non-Firestore provider sources and clauses', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem where p.active = true
mem limit 2
return mem.id(p) as id, p.name`,
      { providers: [testProviderDialect] },
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          limit: 2,
          source: {
            provider: 'mem',
            sourceType: 'collection',
            target: { collection: 'people' },
          },
        },
      },
    });
  });

  it('rejects provider filters that cannot compile to Firestore', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs where "paid" = d.status
fs limit 1
return d.firstName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_FS_WHERE' }),
    );
  });
});
