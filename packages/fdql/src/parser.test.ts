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

  it('keeps unsupported stages as AST stages for compiler diagnostics', () => {
    const result = parseFdql(`alias $drivers = fs.collection("drivers")

from $drivers as d
then lookup one $teams as team
return *`);

    expect(result).toMatchObject({ ok: true });
    expect(result.ast?.stages).toContainEqual(
      expect.objectContaining({ kind: 'unsupported', text: 'then lookup one $teams as team' }),
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
});
