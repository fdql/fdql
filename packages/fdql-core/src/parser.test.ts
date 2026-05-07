import { describe, expect, it } from 'vitest';
import { parseFdql } from './parser.ts';
import type { FdqlAst, FdqlProgram, FdqlUnionProgram } from './types.ts';

const validFixtures: readonly { readonly name: string; readonly source: string; }[] = [
  {
    name: 'basic bounded read',
    source: `set fdql.readBudget = 5000
set fdql.timeout = 60s

alias $drivers = mem.collection("drivers", ["firstName"])

from $drivers as d
mem where d.active = true
mem order by d.createdAt desc
mem limit 100

then filter lower(d.firstName) = "vini"
then take 25

return mem.id(d) as id, d.firstName`,
  },
  {
    name: 'project and named database source',
    source: `alias $prod = "project-1"
alias $prodDb2Drivers = mem.project($prod).db("db2").collection("drivers", ["firstName"])

from $prodDb2Drivers as d
mem where mem.id(d) = "drv_1"
return mem.id(d) as id, d.firstName`,
  },
  {
    name: 'metadata only collection group',
    source: `alias $orders = mem.collection("orders", [])

from $orders as o
mem where o.status in ("paid", "pending")
mem limit 10
return mem.id(o) as id, mem.path(o) as path`,
  },
  {
    name: 'with reshapes rows',
    source: `alias $drivers = mem.collection("drivers", ["firstName"])

from $drivers as d
mem limit 100

then with
  d,
  mem.id(d) as driverId,
  lower(d.firstName) as firstNameKey

return driverId, firstNameKey`,
  },
];

describe('FDQL parser', () => {
  it.each(validFixtures)('parses spec fixture: $name', ({ source }) => {
    expect(parseFdql(source)).toMatchObject({ diagnostics: [], ok: true });
  });

  it('parses lookup stages with provider clauses', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers")
alias $teams = mem.collection("teams")

from $drivers as d
then lookup one $teams as team cache run
  mem where mem.id(team) = d.teamId
  mem limit 1
return *`);

    expect(result).toMatchObject({ ok: true });
    expect(pipelineAst(result).stages).toContainEqual(
      expect.objectContaining({
        cache: 'run',
        clauses: [
          expect.objectContaining({ kind: 'providerWhere', provider: 'mem' }),
          expect.objectContaining({ kind: 'providerLimit', provider: 'mem', value: 1 }),
        ],
        kind: 'lookup',
        mode: 'one',
        rowAlias: 'team',
        sourceAlias: '$teams',
      }),
    );
  });

  it.each(['cache "run"', 'cache = run', 'cache = "run"', 'cache forever'])(
    'rejects malformed lookup cache suffix %s',
    (suffix) => {
      const result = parseFdql(`alias $drivers = mem.collection("drivers")
alias $teams = mem.collection("teams")
from $drivers as d
then lookup one $teams as team ${suffix}
  mem where mem.id(team) = d.teamId
return *`);

      expect(result).toMatchObject({ ok: false });
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_CACHE', line: 4 }),
      );
    },
  );

  it('parses unwind stages', () => {
    const result = parseFdql(`alias $games = mem.collection("games")
from $games as g
mem limit 10
then unwind entries(g.roundsById) as round
return round.key`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(pipelineAst(result).stages).toContainEqual(
      expect.objectContaining({
        kind: 'unwind',
        rowAlias: 'round',
      }),
    );
  });

  it('keeps separators inside single quoted projection strings', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers")
from $drivers as d
mem limit 1
return 'paid, active' as statusLabel, 'keep as text' as note`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(pipelineAst(result).stages).toContainEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({ alias: 'statusLabel' }),
          expect.objectContaining({ alias: 'note' }),
        ],
        kind: 'return',
      }),
    );
  });

  it('strips comments outside strings only', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers") // source
alias $url = "https://example.test/drivers"
from $drivers as d
mem where d.profileUrl = $url
mem limit 1
return d.profileUrl`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
  });

  it('source-locates top-level statements', () => {
    const result = parseFdql(`  alias $drivers = mem.collection("drivers")

  from $drivers as d
  mem limit 1
  return d.firstName`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(pipelineAst(result).aliases[0]).toMatchObject({
      column: 3,
      line: 1,
      range: { endColumn: 45, endLine: 1, startColumn: 3, startLine: 1 },
    });
    expect(pipelineAst(result).from).toMatchObject({
      column: 3,
      line: 3,
      range: { endColumn: 21, endLine: 3, startColumn: 3, startLine: 3 },
    });
  });

  it('reports absolute expression diagnostic columns', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers")
from $drivers as d
  mem where d.active = ?
return d.firstName`);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', column: 24, line: 3 }),
    );
  });

  it('reports statement diagnostic columns', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers")
  from drivers as d
return d.firstName`);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', column: 3, line: 2 }),
    );
  });

  it('rejects set declarations after aliases', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers")
set fdql.readBudget = 5000
from $drivers as d
return d.firstName`);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 2 }),
    );
  });

  it('parses top-level union all branches', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers")
alias $teams = mem.collection("teams")

from $drivers as d
mem limit 1
return mem.id(d) as id

union all

from $teams as t
mem limit 1
return mem.id(t) as id`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ast || !('kind' in result.ast) || result.ast.kind !== 'union') {
      throw new Error('expected union AST');
    }
    expect(result.ast.branches).toHaveLength(2);
    expect(result.ast.branches[1]?.aliases).toHaveLength(2);
  });
});

function pipelineAst(result: ReturnType<typeof parseFdql>): FdqlProgram {
  if (!result.ast || isUnionAst(result.ast)) {
    throw new Error('expected pipeline AST');
  }
  return result.ast;
}

function isUnionAst(ast: FdqlAst): ast is FdqlUnionProgram {
  return 'kind' in ast && ast.kind === 'union';
}
