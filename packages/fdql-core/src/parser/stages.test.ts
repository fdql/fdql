import { describe, expect, it } from 'vitest';
import type { FdqlDiagnostic } from '../types.ts';
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

const range = { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };

describe('FDQL parser stages', () => {
  it('parses provider clauses and local sort stages', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const where = parseProviderClause(
      { column: 1, line: 1, range, text: 'mem where d.active = true' },
      diagnostics,
    );
    const sort = parseSortBy('then sort by d.createdAt desc', 2, 1, range, diagnostics);

    expect(diagnostics).toEqual([]);
    expect(where).toMatchObject({ kind: 'providerWhere', provider: 'mem' });
    expect(sort).toMatchObject({ direction: 'desc', kind: 'sortBy' });
  });

  it('parses unwind and from stages', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const unwind = parseUnwind(
      'then unwind entries(d.roundsById) as round',
      1,
      1,
      range,
      diagnostics,
    );
    const from = parseFrom('from $drivers as d', 2, 1, range, diagnostics);

    expect(diagnostics).toEqual([]);
    expect(unwind).toMatchObject({ kind: 'unwind', rowAlias: 'round' });
    expect(from).toMatchObject({ kind: 'from', rowAlias: 'd', sourceAlias: '$drivers' });
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
  fs where o.status = "paid"
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
  fs where item.status = "paid"
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
