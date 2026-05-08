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

  it('parses multiline statement headers', () => {
    const result = parseFdql(`alias $events = mem.collection("events")
alias $drivers = mem.collection("drivers")

from $events
  as event
mem where
  event.active = true
mem order by
  event.createdAt desc
mem limit
  20
then filter
  event.score > 10
then lookup one
  $drivers
  as driver
  cache run
  mem where
    mem.id(driver) = event.driverId
then unwind
  entries(event.entriesById) as entry
return event.slug, driver.name, entry.key`);

    expect(result).toMatchObject({ diagnostics: [], ok: true });
  });

  it('parses multiline from and provider limit headers split by keyword', () => {
    const result = parseFdql(
      `alias $events = mem.collection("events", ["schedule.startsAt", "total"])

from
  $events
  as
  event
mem
  order
  by
  event.schedule.startsAt desc
mem
  limit
  20
return event.total, event.schedule.startsAt, mem.id(event)`,
    );

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

  it('keeps set and alias declarations one-line', () => {
    const setResult = parseFdql(`set fdql.readBudget =
from $drivers as d
return d`);
    const aliasResult = parseFdql(`alias $drivers =
from $drivers as d
return d`);

    expect(setResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', line: 1 }),
    );
    expect(aliasResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', line: 1 }),
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
