import { describe, expect, it } from 'vitest';
import { createProviderDialectRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlDiagnostic, FdqlProjectionItem } from '../types.ts';
import { compileProviderAggregatePlan } from './provider-aggregate.ts';

const providers = createProviderDialectRegistry([testProviderDialect]);

describe('FDQL compiler provider aggregate', () => {
  it('rejects spread projections in aggregate yield items', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    const plan = compileProviderAggregatePlan({
      diagnostics,
      line: 1,
      providers,
      scalarAliases: {},
      sourceProvider: 'mem',
      yieldItems: [{ item: spread('total'), kind: 'flat' }],
    });

    expect(plan.items).toEqual([]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SPREAD_PROJECTION' }),
    );
  });

  it('plans object yield maps with internal aggregate aliases', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    const plan = compileProviderAggregatePlan({
      diagnostics,
      line: 1,
      providerRowAlias: 'item',
      providers,
      scalarAliases: {},
      sourceProvider: 'mem',
      yieldItems: [{
        alias: 'stats',
        items: [
          aggregateItem('mem.count()', 'total'),
          aggregateItem('mem.sum(item.score)', 'score'),
        ],
        kind: 'map',
        label: 'stats',
      }],
    });

    expect(diagnostics).toEqual([]);
    expect(plan).toMatchObject({
      items: [
        { alias: '__fdql_0', functionName: 'mem.count' },
        { alias: '__fdql_1', functionName: 'mem.sum' },
      ],
      outputs: [{
        alias: 'stats',
        fields: [
          { alias: 'total', itemAlias: '__fdql_0' },
          { alias: 'score', itemAlias: '__fdql_1' },
        ],
        kind: 'map',
      }],
    });
  });
});

function spread(name: string): FdqlProjectionItem {
  return {
    column: 1,
    expression: { kind: 'field', path: [name] },
    label: name,
    line: 1,
    spread: true,
  };
}

function aggregateItem(source: string, alias: string): FdqlProjectionItem {
  const [functionName, field] = source.includes('(')
    ? [source.slice(0, source.indexOf('(')), source.slice(source.indexOf('(') + 1, -1)]
    : [source, ''];
  return {
    alias,
    column: 1,
    expression: {
      args: field ? [{ kind: 'field', path: field.split('.') }] : [],
      kind: 'call',
      name: functionName,
    },
    label: source,
    line: 1,
  };
}
