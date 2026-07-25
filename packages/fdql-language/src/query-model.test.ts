import { describe, expect, it } from 'vitest';
import {
  createFdqlFieldMaskDiagnostics,
  createFdqlQueryModel,
  fieldNamesAtPath,
} from './query-model.ts';

describe('FDQL query model', () => {
  it('scopes row bindings to the current union branch', () => {
    const source = `alias $drivers = fs.collection("drivers", ["firstName"])
alias $teams = fs.collection("teams", ["name"])

from $drivers as d
return d.firstName

union all

from $teams as t
return t.name`;

    const model = createFdqlQueryModel(source, { line: 9 });

    expect(model.aliases.map((alias) => alias.name)).toEqual(['$drivers', '$teams']);
    expect(model.rows.map((row) => row.name)).toEqual(['t']);
    expect(fieldNamesAtPath(model.rows[0]!.mask, [])).toEqual(['name']);
  });

  it('builds nested field trees from string masks and fieldPath masks', () => {
    const source =
      `alias $events = fs.collection("events", ["schedule.startsAt", fs.fieldPath("literal.with.dot"), "entriesById"])
from $events as event
return event.`;

    const model = createFdqlQueryModel(source, { line: 3 });
    const event = model.rows.find((row) => row.name === 'event')!;

    expect(fieldNamesAtPath(event.mask, [])).toEqual([
      'schedule',
      'literal.with.dot',
      'entriesById',
    ]);
    expect(fieldNamesAtPath(event.mask, ['schedule'])).toEqual(['startsAt']);
  });

  it('tracks row binding changes through lookup, unwind, with, and aggregate stages', () => {
    const beforeAggregate = createFdqlQueryModel(
      `alias $events = fs.collection("events", ["entriesById"])
alias $drivers = fs.collection("drivers", ["firstName"])

from $events as event
then lookup one $drivers as driver
  fs where fs.id(driver) = "driver_1"
then unwind entries(event.entriesById) as entry
then with *, driver.firstName as driverName
return `,
      { line: 9 },
    );
    const afterAggregate = createFdqlQueryModel(
      `alias $rounds = fs.collection("rounds", ["driverId", "score"])

from $rounds as round
then aggregate
  by round.driverId as driverId
  yield count() as total
return `,
      { line: 7 },
    );

    expect(beforeAggregate.rows.map((row) => row.name)).toEqual([
      'event',
      'driver',
      'entry',
      'driverName',
    ]);
    expect(afterAggregate.rows.map((row) => row.name)).toEqual(['driverId', 'total']);
  });

  it('keeps provider aggregate row aliases local to the aggregate block', () => {
    const source = `alias $items = fs.collection("items", ["price"])

from $items as sourceItem
then fs.aggregate $items as item
  yield { fs.count() as total } as stats
return stats.`;

    const inYield = createFdqlQueryModel(source, { line: 5 });
    const inReturn = createFdqlQueryModel(source, { line: 6 });

    expect(inYield.rows.map((row) => row.name)).toEqual(['sourceItem', 'item']);
    expect(inReturn.rows.map((row) => row.name)).toEqual(['sourceItem', 'stats']);
    expect(fieldNamesAtPath(inReturn.rows.find((row) => row.name === 'stats')!.mask, []))
      .toEqual(['total']);
  });

  it('warns for local field references outside explicit masks only', () => {
    const diagnostics = createFdqlFieldMaskDiagnostics(
      `alias $events = fs.collection("events", ["schedule.startsAt", "metadata"])
alias $teams = fs.collection("teams", [])
alias $orders = fs.collection("orders")

from $events as event
fs where event.hidden = true
then filter event.schedule.endsAt is missing
then filter mapGet(event.metadata, "dynamic")
then lookup one $teams as team
  fs where fs.id(team) = "team_1"
return event.schedule.startsAt, event.slug, fs.id(team) as teamId`,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'FDQL_FIELD_NOT_IN_MASK',
        line: 7,
        severity: 'warning',
      }),
      expect.objectContaining({
        code: 'FDQL_FIELD_NOT_IN_MASK',
        line: 11,
        severity: 'warning',
      }),
    ]);
  });

  it('locates field mask warnings on the unloaded field segment', () => {
    const diagnostics = createFdqlFieldMaskDiagnostics(
      `alias $events = fs.collection("events", ["schedule.startsAt", "total"])
from $events as event
return event.total, event.schedule.endsAt`,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'FDQL_FIELD_NOT_IN_MASK',
        column: 36,
        endColumn: 42,
        line: 3,
      }),
    ]);
  });
});
