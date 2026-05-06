import { describe, expect, it } from 'vitest';
import { parseFdql } from './parser.ts';

const validFixtures: readonly { readonly name: string; readonly source: string; }[] = [
  {
    name: 'basic bounded read',
    source: `set readBudget = 5000
set timeout = "60s"

alias $drivers = fs.collection("drivers", ["firstName"])

from $drivers as d
fs where d.active = true
fs order by d.createdAt desc
fs limit 100

then filter lower(d.firstName) = "vini"
then take 25

return fs.id(d) as id, d.firstName`,
  },
  {
    name: 'project and named database source',
    source: `alias $prod = "project-1"
alias $prodDb2Drivers = fs.project($prod).db("db2").collection("drivers", ["firstName"])

from $prodDb2Drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d) as id, d.firstName`,
  },
  {
    name: 'metadata only collection group',
    source: `alias $orders = fs.collectionGroup("orders", [])

from $orders as o
fs where o.status in ("paid", "pending")
fs limit 10
return fs.id(o) as id, fs.path(o) as path`,
  },
  {
    name: 'with reshapes rows',
    source: `alias $drivers = fs.collection("drivers", ["firstName"])

from $drivers as d
fs limit 100

then with
  d,
  fs.id(d) as driverId,
  lower(d.firstName) as firstNameKey

return driverId, firstNameKey`,
  },
];

describe('FDQL parser', () => {
  it.each(validFixtures)('parses spec fixture: $name', ({ source }) => {
    expect(parseFdql(source)).toMatchObject({ diagnostics: [], ok: true });
  });

  it('parses lookup stages with native clauses', () => {
    const result = parseFdql(`alias $drivers = fs.collection("drivers")
alias $teams = fs.collection("teams")

from $drivers as d
then lookup one $teams as team
  fs where fs.id(team) = d.teamId
  fs limit 1
return *`);

    expect(result).toMatchObject({ ok: true });
    expect(result.ast?.stages).toContainEqual(
      expect.objectContaining({
        clauses: [
          expect.objectContaining({ kind: 'fsWhere' }),
          expect.objectContaining({ kind: 'fsLimit', value: 1 }),
        ],
        kind: 'lookup',
        mode: 'one',
        rowAlias: 'team',
        sourceAlias: '$teams',
      }),
    );
  });

  it('parses unwind stages', () => {
    const result = parseFdql(`alias $games = fs.collection("games")
from $games as g
fs limit 10
then unwind entries(g.roundsById) as round
return round.key`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(result.ast?.stages).toContainEqual(
      expect.objectContaining({
        kind: 'unwind',
        rowAlias: 'round',
      }),
    );
  });

  it('keeps separators inside single quoted projection strings', () => {
    const result = parseFdql(`alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return 'paid, active' as statusLabel, 'keep as text' as note`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(result.ast?.stages).toContainEqual(
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
    const result = parseFdql(`alias $drivers = fs.collection("drivers") // source
alias $url = "https://example.test/drivers"
from $drivers as d
fs where d.profileUrl = $url
fs limit 1
return d.profileUrl`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
  });

  it('source-locates top-level statements', () => {
    const result = parseFdql(`  alias $drivers = fs.collection("drivers")

  from $drivers as d
  fs limit 1
  return d.firstName`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(result.ast?.aliases[0]).toMatchObject({
      column: 3,
      line: 1,
      range: { endColumn: 44, endLine: 1, startColumn: 3, startLine: 1 },
    });
    expect(result.ast?.from).toMatchObject({
      column: 3,
      line: 3,
      range: { endColumn: 21, endLine: 3, startColumn: 3, startLine: 3 },
    });
  });

  it('reports absolute expression diagnostic columns', () => {
    const result = parseFdql(`alias $drivers = fs.collection("drivers")
from $drivers as d
  fs where d.active = ?
return d.firstName`);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', column: 23, line: 3 }),
    );
  });

  it('reports statement diagnostic columns', () => {
    const result = parseFdql(`alias $drivers = fs.collection("drivers")
  from drivers as d
return d.firstName`);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', column: 3, line: 2 }),
    );
  });
});
