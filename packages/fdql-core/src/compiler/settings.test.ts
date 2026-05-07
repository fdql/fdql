import { describe, expect, it } from 'vitest';
import { createProviderDialectRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlDiagnostic, FdqlExpression, FdqlSetDeclaration } from '../types.ts';
import { scalarValue } from '../value.ts';
import { resolveSettings } from './settings.ts';

const providers = createProviderDialectRegistry([{
  ...testProviderDialect,
  resolveSetting(input) {
    if (input.key === 'projectId') return { projectId: scalarValue(input.value) };
    input.diagnostics.push({
      code: 'FDQL_UNKNOWN_SET_KEY',
      line: input.line,
      message: `Unknown set key mem.${input.key}.`,
      severity: 'error',
    });
    return null;
  },
}]);

describe('FDQL compiler settings', () => {
  it('resolves engine and provider settings', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const result = resolveSettings(
      [
        setDeclaration('fdql.readBudget', '7', literal(7), 1),
        setDeclaration('fdql.timeout', '2s', undefined, 2),
        setDeclaration('fdql.cache', 'run', literal('run'), 3),
        setDeclaration('fdql.cacheTtl', '2h', undefined, 4),
        setDeclaration('fdql.allowUnboundedReads', 'true', literal(true), 5),
        setDeclaration('mem.projectId', '"local"', literal('local'), 6),
      ],
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(result).toMatchObject({
      providerContext: { mem: { projectId: 'local' } },
      settings: {
        allowUnboundedReads: true,
        cache: 'run',
        cacheTtlMs: 7_200_000,
        readBudget: 7,
        timeoutMs: 2000,
      },
    });
  });

  it('rejects unscoped, duplicate, unknown, and invalid settings', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    resolveSettings(
      [
        setDeclaration('readBudget', '7', literal(7), 1),
        setDeclaration('fdql.pageSize', '100', literal(100), 2),
        setDeclaration('fb.region', '"us"', literal('us'), 3),
        setDeclaration('mem.region', '"us"', literal('us'), 4),
        setDeclaration('fdql.readBudget', '10', literal(10), 5),
        setDeclaration('fdql.readBudget', '20', literal(20), 6),
        setDeclaration('fdql.cache', '"run"', literal('run'), 7),
        setDeclaration('fdql.cacheTtl', '31d', undefined, 8),
      ],
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_INVALID_SET_KEY', line: 1 }),
        expect.objectContaining({ code: 'FDQL_UNKNOWN_SET_KEY', line: 2 }),
        expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 3 }),
        expect.objectContaining({ code: 'FDQL_UNKNOWN_SET_KEY', line: 4 }),
        expect.objectContaining({ code: 'FDQL_DUPLICATE_SET', line: 6 }),
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 7 }),
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 8 }),
      ]),
    );
  });
});

function setDeclaration(
  key: string,
  rawValue: string,
  value: FdqlExpression | undefined,
  line: number,
): FdqlSetDeclaration {
  return {
    column: 1,
    key,
    line,
    range: { endColumn: 1, endLine: line, startColumn: 1, startLine: line },
    rawValue,
    ...(value ? { value } : {}),
  };
}

function literal(value: boolean | number | string): FdqlExpression {
  return { kind: 'literal', value };
}
