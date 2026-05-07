import { describe, expect, it } from 'vitest';
import type { FdqlDiagnostic } from '../types.ts';
import { parseAlias, parseSet } from './preamble.ts';

const range = { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };

describe('FDQL parser preamble', () => {
  it('parses set declarations with raw duration values', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const declaration = parseSet('set fdql.timeout = 60s', 1, 1, range, diagnostics);

    expect(diagnostics).toEqual([]);
    expect(declaration).toMatchObject({
      key: 'fdql.timeout',
      rawValue: '60s',
    });
    expect(declaration).not.toHaveProperty('value');
  });

  it('parses alias declarations', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const declaration = parseAlias(
      'alias $drivers = mem.collection("drivers")',
      1,
      1,
      range,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(declaration).toMatchObject({
      name: '$drivers',
      value: { kind: 'call', name: 'mem.collection' },
    });
  });

  it('reports invalid preamble separators', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    parseSet('set fdql.timeout 60s', 1, 1, range, diagnostics);
    parseAlias('alias $drivers mem.collection("drivers")', 2, 1, range, diagnostics);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 1 }),
        expect.objectContaining({ code: 'FDQL_INVALID_ALIAS_NAME', line: 2 }),
      ]),
    );
  });
});
