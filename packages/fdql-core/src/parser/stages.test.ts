import { describe, expect, it } from 'vitest';
import type { FdqlDiagnostic } from '../types.ts';
import {
  parseAggregate,
  parseFrom,
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

  it('requires aggregate aliases', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    parseAggregate('by d.teamId\ncount()', 1, 1, 1, 1, range, diagnostics);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_PARSE_ERROR', line: 1 }),
        expect.objectContaining({ code: 'FDQL_PARSE_ERROR', line: 1 }),
      ]),
    );
  });
});
