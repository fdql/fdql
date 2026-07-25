import { describe, expect, it } from 'vitest';
import { createProviderDialectRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlLookupStage,
  FdqlProviderAggregateStage,
} from '../types.ts';
import type { ResolvedAliasValue } from './aliases.ts';
import { resolveProviderStageSource } from './provider-source.ts';

const providers = createProviderDialectRegistry([testProviderDialect]);
const range = { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };

describe('FDQL compiler provider source', () => {
  it('binds template sources with an explicit parent row', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = resolveProviderStageSource(
      lookupStage({ parent: field('order'), sourceAlias: '$items' }),
      templateAliases(),
      new Set(['order']),
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(source).toMatchObject({
      binding: { expression: { kind: 'field', path: ['order'] }, kind: 'parent' },
    });
  });

  it('rejects lookup template sources without a parent row', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = resolveProviderStageSource(
      lookupStage({ sourceAlias: '$items' }),
      templateAliases(),
      new Set(['order']),
      {},
      providers,
      diagnostics,
    );

    expect(source).toBeNull();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_PARENT' }),
    );
  });

  it('rejects aggregate template sources without a parent row', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = resolveProviderStageSource(
      providerAggregateStage({ sourceAlias: '$items' }),
      templateAliases(),
      new Set(['order']),
      {},
      providers,
      diagnostics,
    );

    expect(source).toBeNull();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_PROVIDER_PARENT' }),
    );
  });

  it('resolves inline provider source calls', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = resolveProviderStageSource(
      providerAggregateStage({
        sourceAlias: 'mem.collection("items")',
        sourceExpression: call('mem.collection', literal('items')),
      }),
      {},
      new Set(['order']),
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(source).toMatchObject({
      source: {
        provider: 'mem',
        sourceType: 'collection',
        target: { collection: 'items' },
      },
    });
  });
});

function templateAliases(): Readonly<Record<string, ResolvedAliasValue>> {
  return {
    $items: {
      binding: { kind: 'parent' },
      kind: 'source',
      source: {
        provider: 'mem',
        sourceAlias: '$items',
        sourceType: 'child',
        target: { collection: 'items' },
      },
    },
  };
}

function lookupStage(
  overrides: Pick<FdqlLookupStage, 'sourceAlias'> & Partial<FdqlLookupStage>,
): FdqlLookupStage {
  return {
    clauses: [],
    column: 1,
    kind: 'lookup',
    line: 1,
    mode: 'many',
    range,
    required: false,
    rowAlias: 'item',
    ...overrides,
  };
}

function providerAggregateStage(
  overrides: Pick<FdqlProviderAggregateStage, 'sourceAlias'> & Partial<FdqlProviderAggregateStage>,
): FdqlProviderAggregateStage {
  return {
    clauses: [],
    column: 1,
    kind: 'providerAggregate',
    line: 1,
    provider: 'mem',
    range,
    ...overrides,
  };
}

function field(name: string): FdqlExpression {
  return { kind: 'field', path: [name] };
}

function literal(value: string): FdqlExpression {
  return { kind: 'literal', value };
}

function call(name: string, ...args: FdqlExpression[]): FdqlExpression {
  return { args, kind: 'call', name };
}
