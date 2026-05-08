import { describe, expect, it } from 'vitest';
import { createProviderDialectRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlDiagnostic, FdqlProjectionItem } from '../types.ts';
import { compileProviderAggregateItems } from './provider-aggregate.ts';

const providers = createProviderDialectRegistry([testProviderDialect]);

describe('FDQL compiler provider aggregate', () => {
  it('rejects spread projections in aggregate yield items', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    const items = compileProviderAggregateItems({
      diagnostics,
      line: 1,
      providers,
      scalarAliases: {},
      sourceProvider: 'mem',
      yieldItems: [spread('total')],
    });

    expect(items).toEqual([]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SPREAD_PROJECTION' }),
    );
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
