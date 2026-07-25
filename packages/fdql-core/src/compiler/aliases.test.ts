import { describe, expect, it } from 'vitest';
import { createProviderDialectRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlAliasDeclaration, FdqlDiagnostic, FdqlExpression } from '../types.ts';
import { stringValue } from '../value.ts';
import { resolveAliases, scalarAliases } from './aliases.ts';

const providers = createProviderDialectRegistry([testProviderDialect]);

describe('FDQL compiler aliases', () => {
  it('resolves scalar aliases and provider source aliases', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const aliases = resolveAliases(
      [
        alias('$project', literal('local')),
        alias('$people', call('mem.collection', literal('people'))),
      ],
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(scalarAliases(aliases)).toEqual({ $project: stringValue('local') });
    expect(aliases.$people).toMatchObject({
      kind: 'source',
      source: { provider: 'mem', target: { collection: 'people' } },
    });
  });

  it('rejects duplicate aliases and unknown source namespaces', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    resolveAliases(
      [
        alias('$people', literal('first')),
        alias('$people', literal('second'), 2),
        alias('$bad', call('fb.collection', literal('people')), 3),
      ],
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_ALIAS_NAME', line: 2 }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 3 }),
    );
  });
});

function alias(name: string, value: FdqlExpression, line = 1): FdqlAliasDeclaration {
  return {
    column: 1,
    line,
    name,
    range: { endColumn: 1, endLine: line, startColumn: 1, startLine: line },
    value,
  };
}

function call(name: string, ...args: readonly FdqlExpression[]): FdqlExpression {
  return { args, kind: 'call', name };
}

function literal(value: string): FdqlExpression {
  return { kind: 'literal', value };
}
