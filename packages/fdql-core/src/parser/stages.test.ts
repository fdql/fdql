import { describe, expect, it } from 'vitest';
import type { FdqlDiagnostic } from '../types.ts';
import { collectStatementBlock } from './source-block.ts';
import { createSourceLines } from './source-text.ts';
import {
  parseAggregateFrom,
  parseAggregateStage,
  parseFrom,
  parseProviderAggregateStage,
  parseProviderClause,
  parseSortBy,
  parseUnwind,
} from './stages.ts';

describe('FDQL parser stages', () => {
  it('parses provider clauses and local sort stages', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const where = parseProviderClause(
      statement('mem where d.active = true'),
      diagnostics,
    );
    const sort = parseSortBy(statement('then sort by d.createdAt desc'), diagnostics);

    expect(diagnostics).toEqual([]);
    expect(where).toMatchObject({ kind: 'providerWhere', provider: 'mem' });
    expect(sort).toMatchObject({ direction: 'desc', kind: 'sortBy' });
  });

  it('parses unwind and from stages', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const unwind = parseUnwind(
      statement('then unwind entries(d.roundsById) as round'),
      diagnostics,
    );
    const from = parseFrom(statement('from $drivers as d'), diagnostics);

    expect(diagnostics).toEqual([]);
    expect(unwind).toMatchObject({ kind: 'unwind', rowAlias: 'round' });
    expect(from).toMatchObject({ kind: 'from', rowAlias: 'd', sourceAlias: '$drivers' });
  });

  it('locates malformed from diagnostics on the missing or bad token', () => {
    const sourceOnlyDiagnostics: FdqlDiagnostic[] = [];
    parseFrom(statement('from $events'), sourceOnlyDiagnostics);

    const badAliasDiagnostics: FdqlDiagnostic[] = [];
    parseFrom(statement('from $events as 12'), badAliasDiagnostics);

    expect(sourceOnlyDiagnostics).toEqual([
      expect.objectContaining({
        code: 'FDQL_PARSE_ERROR',
        column: 13,
        endColumn: 13,
        line: 1,
      }),
    ]);
    expect(badAliasDiagnostics).toEqual([
      expect.objectContaining({
        code: 'FDQL_PARSE_ERROR',
        column: 17,
        endColumn: 19,
        line: 1,
      }),
    ]);
  });

  it('rejects a from alias after long whitespace', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    parseFrom(statement(`from $_ as ${' '.repeat(20_000)}!`), diagnostics);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', line: 1 }),
    );
  });

  it('parses multiline statement headers and provider clauses', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const from = parseFrom(
      statement(`from $events
  as event`),
      diagnostics,
    );
    const where = parseProviderClause(
      statement(`mem where
  event.active = true`),
      diagnostics,
    );
    const order = parseProviderClause(
      statement(`mem order by
  event.createdAt desc`),
      diagnostics,
    );
    const limit = parseProviderClause(
      statement(`mem limit
  20`),
      diagnostics,
    );
    const filter = parseSortBy(
      statement(`then sort by
  event.createdAt desc`),
      diagnostics,
    );
    const unwind = parseUnwind(
      statement(`then unwind
  entries(event.entriesById) as entry`),
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(from).toMatchObject({ rowAlias: 'event', sourceAlias: '$events' });
    expect(where).toMatchObject({ kind: 'providerWhere' });
    expect(order).toMatchObject({ direction: 'desc', kind: 'providerOrderBy' });
    expect(limit).toMatchObject({ kind: 'providerLimit', value: 20 });
    expect(filter).toMatchObject({ direction: 'desc', kind: 'sortBy' });
    expect(unwind).toMatchObject({ kind: 'unwind', rowAlias: 'entry' });
  });

  it('parses local aggregate by and yield blocks', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const aggregate = parseAggregateStage(
      createSourceLines(`then aggregate
  by d.teamId as teamId
  yield count() as total`),
      0,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(aggregate.stage.groups).toHaveLength(1);
    expect(aggregate.stage.items).toHaveLength(1);
  });

  it('requires local aggregate yield aliases', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    parseAggregateStage(
      createSourceLines(`then aggregate
  by d.teamId
  yield count()`),
      0,
      diagnostics,
    );

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', line: 1 }),
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR', line: 1 }),
    ]));
  });

  it('rejects old local aggregate bodies without yield', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    parseAggregateStage(
      createSourceLines(`then aggregate
  count() as total`),
      0,
      diagnostics,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FDQL_PARSE_ERROR',
        message: 'Aggregate blocks need `yield`.',
      }),
    );
  });

  it('parses provider aggregate from sources', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const parsed = parseAggregateFrom(
      createSourceLines(`from fs.aggregate $orders as o
  fs
    where
    o.status = "paid"
  yield fs.count() as total`),
      0,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(parsed?.from).toMatchObject({
      mode: 'aggregate',
      provider: 'fs',
      providerRowAlias: 'o',
      sourceAlias: '$orders',
    });
  });

  it('parses provider aggregate pipeline stages and object yield maps', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const parsed = parseProviderAggregateStage(
      createSourceLines(`then fs.aggregate $items of order as item cache run
  fs
    where
    item.status = "paid"
  yield { fs.count() as itemCount, fs.sum(item.price) as itemTotal } as itemStats`),
      0,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(parsed.stage).toMatchObject({
      cache: 'run',
      kind: 'providerAggregate',
      parent: { path: ['order'] },
      provider: 'fs',
      providerRowAlias: 'item',
      sourceAlias: '$items',
      yieldItems: [
        {
          alias: 'itemStats',
          items: [
            { alias: 'itemCount' },
            { alias: 'itemTotal' },
          ],
          kind: 'map',
        },
      ],
    });
  });
});

function statement(source: string) {
  return collectStatementBlock(createSourceLines(source), 0);
}
