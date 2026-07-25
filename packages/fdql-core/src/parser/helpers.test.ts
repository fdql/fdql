import { describe, expect, it } from 'vitest';
import type { FdqlAst } from '../types.ts';
import {
  isProviderClauseStart,
  isStatementStart,
  isUnionAst,
  parserError,
  providerFromStatement,
} from './helpers.ts';

describe('FDQL parser helpers', () => {
  it('creates stable parser diagnostics', () => {
    expect(parserError('FDQL_PARSE_ERROR', 'Bad statement.', 2, 7)).toEqual({
      code: 'FDQL_PARSE_ERROR',
      column: 7,
      line: 2,
      message: 'Bad statement.',
      severity: 'error',
    });
  });

  it('detects provider clause starts', () => {
    expect(providerFromStatement('fs where status = "paid"')).toBe('fs');
    expect(providerFromStatement('mem order by createdAt desc')).toBe('mem');
    expect(providerFromStatement('fdql limit 10')).toBe('fdql');
    expect(providerFromStatement('then filter row.active')).toBeNull();

    expect(isProviderClauseStart('fs limit 1')).toBe(true);
    expect(isProviderClauseStart('return row')).toBe(false);
  });

  it('detects statement starts and union ASTs', () => {
    expect(isStatementStart('set fdql.readBudget = 10')).toBe(true);
    expect(isStatementStart('alias $orders = fs.collection("orders")')).toBe(true);
    expect(isStatementStart('fs where status = "paid"')).toBe(true);
    expect(isStatementStart('not a statement')).toBe(false);

    const unionAst: FdqlAst = { branches: [], kind: 'union' };
    const programAst: FdqlAst = { aliases: [], settings: [], stages: [] };
    expect(isUnionAst(unionAst)).toBe(true);
    expect(isUnionAst(programAst)).toBe(false);
  });
});
