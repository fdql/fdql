import { describe, expect, it } from 'vitest';
import { parseFdql } from './parser.ts';

describe('FDQL parser composer', () => {
  it('parses a bounded read pipeline', () => {
    const result = parseFdql(`set fdql.readBudget = 5000
alias $drivers = mem.collection("drivers", ["firstName"])

from $drivers as d
mem where d.active = true
mem order by d.createdAt desc
mem limit 100
then filter lower(d.firstName) = "vini"
return mem.id(d) as id, d.firstName`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
  });

  it('reports preamble ordering diagnostics', () => {
    const result = parseFdql(`alias $drivers = mem.collection("drivers")
set fdql.readBudget = 5000
from $drivers as d
return d.firstName`);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 2 }),
    );
  });

  it('parses top-level union all branches with shared preamble', () => {
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
    expect(result.ast).toMatchObject({ branches: [expect.any(Object), expect.any(Object)] });
  });
});
