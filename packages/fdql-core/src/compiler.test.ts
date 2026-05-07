import { describe, expect, it } from 'vitest';
import { compileFdql, compileFdqlRead } from './compiler.ts';
import { testProviderDialect } from './test-helpers/provider.ts';

const options = {
  providers: [testProviderDialect],
};

describe('FDQL compiler', () => {
  it('plans provider reads with provider clauses', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem where p.active = true
mem order by p.createdAt desc
mem limit 25
return mem.id(p) as id, p.name`,
      options,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          limit: 25,
          orderBy: { direction: 'desc' },
          source: {
            provider: 'mem',
            sourceType: 'collection',
            target: { collection: 'people' },
          },
        },
      },
    });
  });

  it('plans namespaced engine settings', () => {
    const result = compileFdqlRead(
      `set fdql.readBudget = 7
set fdql.timeout = 2s
set fdql.cache = run
set fdql.cacheTtl = 2h
set fdql.allowUnboundedReads = true
alias $people = mem.collection("people")
from $people as p
return p.name`,
      options,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        settings: {
          allowUnboundedReads: true,
          cache: 'run',
          cacheTtlMs: 7_200_000,
          readBudget: 7,
          timeoutMs: 2000,
        },
      },
    });
  });

  it('rejects unscoped set keys', () => {
    const result = compileFdqlRead(
      `set pageSize = 100
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
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
set mem.region = "us"
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
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
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_DUPLICATE_SET', line: 2 }),
    );
  });

  it('rejects invalid set values', () => {
    const result = compileFdqlRead(
      `set fdql.readBudget = count()
set fdql.timeout = "2s"
set fdql.cache = "run"
set fdql.cacheTtl = "2h"
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 1 }),
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 2 }),
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 3 }),
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 4 }),
      ]),
    );
  });

  it('rejects unsupported cache modes', () => {
    const result = compileFdqlRead(
      `set fdql.cache = session
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 1 }),
    );
  });

  it.each([
    'clear cache',
    'clear cache provider mem',
    'clear cache provider mem project "local"',
  ])('reports reserved cache command as unsupported: %s', (source) => {
    const result = compileFdqlRead(source, options);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_COMMAND', line: 1 }),
    ]);
  });

  it.each([
    ['clear cache', {}],
    ['clear cache provider mem', { provider: 'mem' }],
    ['clear cache provider mem project "local"', { projectId: 'local', provider: 'mem' }],
  ])('compiles cache clear command: %s', (source, plan) => {
    const result = compileFdql(source, options);

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: { kind: 'clearCache', ...plan },
    });
  });

  it('rejects cache clear command mixed with a pipeline', () => {
    const result = compileFdql(
      `clear cache
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_COMMAND_MIXED_WITH_PIPELINE', line: 1 }),
    );
  });

  it('rejects cache clear command with unknown provider namespace', () => {
    const result = compileFdql('clear cache provider fb', options);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 1 }),
    );
  });

  it('rejects malformed cache clear project selector', () => {
    const result = compileFdql('clear cache provider mem project local', options);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_COMMAND', line: 1 }),
    );
  });

  it('rejects persistent cache TTL over 30 days', () => {
    const result = compileFdqlRead(
      `set fdql.cacheTtl = 31d
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 1 }),
    );
  });

  it('rejects undeclared aliases', () => {
    const result = compileFdqlRead(
      `from $people as p
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNDECLARED_ALIAS' }),
    );
  });

  it('blocks unbounded provider reads by default', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNBOUNDED_PROVIDER_READ' }),
    );
  });

  it('requires explicit providers in core', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      {},
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE' }),
    );
  });

  it('rejects unknown provider namespaces', () => {
    const result = compileFdqlRead(
      `alias $people = fb.collection("people")
from $people as p
fb limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE' }),
    );
  });

  it('plans lookup stages with correlated provider filters', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
alias $teams = mem.collection("teams")
from $people as p
mem limit 10
then lookup one $teams as team
  mem where team.id = p.teamId
return p.name, team.name as teamName`,
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
  });

  it('plans lookup cache overrides', () => {
    const result = compileFdqlRead(
      `set fdql.cache = off
alias $people = mem.collection("people")
alias $teams = mem.collection("teams")
from $people as p
mem limit 10
then lookup one $teams as team cache run
  mem where team.id = p.teamId
return p.name, team.name as teamName`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    if (result.plan.kind !== 'read') throw new Error('expected read plan');
    expect(result.plan.localStages[0]).toMatchObject({
      cache: 'run',
      kind: 'lookup',
    });
  });

  it('plans required lookup one stages', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
alias $teams = mem.collection("teams")
from $people as p
mem limit 10
then lookup required one $teams as team cache run
  mem where team.id = p.teamId
return p.name, team.name as teamName`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    if (result.plan.kind !== 'read') throw new Error('expected read plan');
    expect(result.plan.localStages[0]).toMatchObject({
      cache: 'run',
      kind: 'lookup',
      mode: 'one',
      required: true,
    });
  });

  it('plans persistent lookup cache overrides with TTL', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
alias $teams = mem.collection("teams")
from $people as p
mem limit 10
then lookup one $teams as team cache persistent 10m
  mem where team.id = p.teamId
return p.name, team.name as teamName`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    if (result.plan.kind !== 'read') throw new Error('expected read plan');
    expect(result.plan.localStages[0]).toMatchObject({
      cache: 'persistent',
      cacheTtlMs: 600_000,
      kind: 'lookup',
    });
  });

  it('rejects TTL on non-persistent lookup cache', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
alias $teams = mem.collection("teams")
from $people as p
mem limit 10
then lookup one $teams as team cache run 10m
  mem where team.id = p.teamId
return p.name, team.name as teamName`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_CACHE', line: 5 }),
    );
  });

  it('plans provider-neutral local stages', () => {
    const result = compileFdqlRead(
      `alias $rounds = mem.collection("rounds")
from $rounds as r
mem limit 100
then unwind entries(r.metadata) as entry
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
        expect.objectContaining({ kind: 'unwind' }),
        expect.objectContaining({ kind: 'sortBy' }),
        expect.objectContaining({ kind: 'aggregate' }),
      ]),
    );
  });

  it('plans top-level union all branches', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
alias $teams = mem.collection("teams")

from $people as p
mem limit 1
return mem.id(p) as id

union all

from $teams as t
mem limit 1
return mem.id(t) as id`,
      options,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok) throw new Error('expected compile success');
    expect(result.plan).toMatchObject({ branches: expect.any(Array), kind: 'union' });
  });

  it('rejects duplicate singleton provider stages', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem order by p.name asc
mem order by p.createdAt asc
mem limit 1
mem limit 1
return mem.id(p) as id`,
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
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name
return p.teamId`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE', line: 5 }),
    );
  });

  it('rejects unknown return function namespaces', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return fb.unknown(p), p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 4 }),
    );
  });

  it('rejects provider filters that provider dialects cannot compile', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem where "paid" = p.status
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_PROVIDER_WHERE' }),
    );
  });
});
