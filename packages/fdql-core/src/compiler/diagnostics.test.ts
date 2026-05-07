import { describe, expect, it } from 'vitest';
import { compilerError, duplicateStage } from './diagnostics.ts';

describe('FDQL compiler diagnostics', () => {
  it('creates stable compiler errors with optional source lines', () => {
    expect(compilerError('FDQL_UNKNOWN_ALIAS', 'Unknown alias $orders.', 4)).toEqual({
      code: 'FDQL_UNKNOWN_ALIAS',
      line: 4,
      message: 'Unknown alias $orders.',
      severity: 'error',
    });
    expect(compilerError('FDQL_UNKNOWN_ALIAS', 'Unknown alias $orders.')).toEqual({
      code: 'FDQL_UNKNOWN_ALIAS',
      message: 'Unknown alias $orders.',
      severity: 'error',
    });
  });

  it('reports duplicate stages with first and duplicate lines', () => {
    expect(duplicateStage('fs limit', 3, 5)).toEqual({
      code: 'FDQL_DUPLICATE_STAGE',
      line: 5,
      message:
        'fs limit can only appear once for the current provider source. First used on line 3.',
      severity: 'error',
    });
  });
});
