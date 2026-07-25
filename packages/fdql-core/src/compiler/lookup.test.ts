import { describe, expect, it } from 'vitest';
import { parseFdql } from '../parser.ts';
import { createProviderDialectRegistry, type FdqlProviderDialect } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlDiagnostic, FdqlLookupStage, FdqlProgram, FdqlStage } from '../types.ts';
import type { ResolvedAliasValue } from './aliases.ts';
import { compileLookupStage } from './lookup.ts';

const providers = createProviderDialectRegistry([testProviderDialect]);
const aliases: Readonly<Record<string, ResolvedAliasValue>> = {
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
  $orders: {
    kind: 'source',
    source: {
      provider: 'mem',
      sourceAlias: '$orders',
      sourceType: 'collection',
      target: { collection: 'orders' },
    },
  },
  $teams: {
    kind: 'source',
    source: {
      provider: 'mem',
      sourceAlias: '$teams',
      sourceType: 'collection',
      target: { collection: 'teams' },
    },
  },
};

describe('FDQL compiler lookup stages', () => {
  it('plans correlated lookup filters', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const stage = compileLookupStage(
      lookupStage(`then lookup one $teams as team
  mem where team.id = p.teamId`),
      aliases,
      new Set(['p']),
      {},
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(stage).toMatchObject({
      kind: 'lookup',
      mode: 'one',
      provider: { predicate: expect.objectContaining({ kind: 'binary' }) },
      rowAlias: 'team',
      sourceAlias: '$teams',
    });
  });

  it('plans inline and parent-bound lookup sources through provider hooks', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const inline = compileLookupStage(
      lookupStage('then lookup many mem.child(order, "items") as inlineItem'),
      aliases,
      new Set(['order']),
      {},
      {},
      providers,
      diagnostics,
    );
    const template = compileLookupStage(
      lookupStage('then lookup many $items of order as templateItem'),
      aliases,
      new Set(['order']),
      {},
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(inline).toMatchObject({
      provider: {
        binding: { expression: expect.objectContaining({ path: ['order'] }), kind: 'parent' },
        source: { sourceAlias: 'mem.child(order, "items")', sourceType: 'child' },
      },
      rowAlias: 'inlineItem',
    });
    expect(template).toMatchObject({
      provider: {
        binding: { expression: expect.objectContaining({ path: ['order'] }), kind: 'parent' },
        source: { sourceAlias: '$items', sourceType: 'child' },
      },
      rowAlias: 'templateItem',
    });
  });

  it('rejects invalid parent binding use', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    compileLookupStage(
      lookupStage('then lookup many $items as item'),
      aliases,
      new Set(['order']),
      {},
      {},
      providers,
      diagnostics,
    );
    compileLookupStage(
      lookupStage('then lookup many $teams of order as item'),
      aliases,
      new Set(['order']),
      {},
      {},
      providers,
      diagnostics,
    );
    compileLookupStage(
      lookupStage('then lookup many $items of missing as item'),
      aliases,
      new Set(['order']),
      {},
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_PARENT' }),
        expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_PARENT' }),
        expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_PARENT' }),
      ]),
    );
  });

  it('plans required lookup one and cache overrides', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const stage = compileLookupStage(
      lookupStage(`then lookup required one $teams as team cache persistent 10m
  mem where team.id = p.teamId`),
      aliases,
      new Set(['p']),
      {},
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(stage).toMatchObject({
      cache: 'persistent',
      cacheTtlMs: 600_000,
      mode: 'one',
      required: true,
    });
  });

  it('passes lookup provider clauses to provider query validation', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    compileLookupStage(
      lookupStage(`then lookup many $teams as team
  mem where team.id = p.teamId
  mem order by team.name asc`),
      aliases,
      new Set(['p']),
      {},
      {},
      createProviderDialectRegistry([queryValidationProvider()]),
      diagnostics,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'TEST_PROVIDER_QUERY', line: 5 }),
    );
  });

  it('rejects TTL on non-persistent lookup cache', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    compileLookupStage(
      lookupStage(`then lookup one $teams as team cache run 10m
  mem where team.id = p.teamId`),
      aliases,
      new Set(['p']),
      {},
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_CACHE', line: 3 }),
    );
  });
});

function lookupStage(source: string): FdqlLookupStage {
  const result = parseFdql(`alias $orders = mem.collection("orders")
from $orders as p
${source}
return *`);
  if (!result.ok || !result.ast || 'kind' in result.ast) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const stage = (result.ast as FdqlProgram).stages.find(isLookupStage);
  if (!stage) throw new Error('expected lookup stage');
  return stage;
}

function isLookupStage(stage: FdqlStage): stage is FdqlLookupStage {
  return stage.kind === 'lookup';
}

function queryValidationProvider(): FdqlProviderDialect {
  return {
    ...testProviderDialect,
    validateQuery(input) {
      if (!input.lookup || !input.predicate || !input.orderBy) return;
      input.diagnostics.push({
        code: 'TEST_PROVIDER_QUERY',
        ...(input.orderByLine === undefined ? {} : { line: input.orderByLine }),
        message: 'Lookup provider query validation ran.',
        severity: 'error',
      });
    },
  };
}
