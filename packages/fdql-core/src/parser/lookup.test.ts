import { describe, expect, it } from 'vitest';
import type { FdqlDiagnostic } from '../types.ts';
import { parseLookup } from './lookup.ts';
import { createSourceLines } from './source-text.ts';

describe('FDQL parser lookup', () => {
  it('parses lookup headers, parent bindings, provider clauses, and cache suffixes', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const result = parseLookup(
      createSourceLines(`then lookup required one $items of order as item cache persistent 10m
  mem where mem.id(item) = order.itemId
  mem limit 1`),
      0,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(result.stage).toMatchObject({
      cache: 'persistent',
      cacheTtlRaw: '10m',
      clauses: [
        expect.objectContaining({ kind: 'providerWhere', provider: 'mem' }),
        expect.objectContaining({ kind: 'providerLimit', provider: 'mem', value: 1 }),
      ],
      kind: 'lookup',
      mode: 'one',
      parent: expect.objectContaining({ kind: 'field', path: ['order'] }),
      required: true,
      rowAlias: 'item',
      sourceAlias: '$items',
    });
  });

  it('parses inline provider lookup sources', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const result = parseLookup(
      createSourceLines('then lookup many mem.child(order, "items") as item cache run'),
      0,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(result.stage).toMatchObject({
      cache: 'run',
      sourceAlias: 'mem.child(order, "items")',
      sourceExpression: { kind: 'call', name: 'mem.child' },
    });
  });

  it('parses aggregate lookup headers and yield projections', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const result = parseLookup(
      createSourceLines(`then lookup aggregate $rounds as stats from round cache run
  mem where round.driverId = mem.id(driver)
  yield mem.count() as total, mem.max(round.createdAt) as lastRoundAt`),
      0,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(result.stage).toMatchObject({
      cache: 'run',
      clauses: [expect.objectContaining({ kind: 'providerWhere', provider: 'mem' })],
      kind: 'lookup',
      mode: 'aggregate',
      providerRowAlias: 'round',
      rowAlias: 'stats',
      sourceAlias: '$rounds',
      yieldItems: [
        expect.objectContaining({ alias: 'total' }),
        expect.objectContaining({ alias: 'lastRoundAt' }),
      ],
    });
  });

  it('rejects malformed cache suffixes and invalid required modes', () => {
    const invalidCache: FdqlDiagnostic[] = [];
    parseLookup(
      createSourceLines('then lookup one $items as item cache = run'),
      0,
      invalidCache,
    );
    const invalidRequired: FdqlDiagnostic[] = [];
    parseLookup(
      createSourceLines('then lookup required many $items as item'),
      0,
      invalidRequired,
    );

    expect(invalidCache).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_CACHE', line: 1 }),
    );
    expect(invalidRequired).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_STAGE', line: 1 }),
    );
  });
});
