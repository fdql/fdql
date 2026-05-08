import { describe, expect, it } from 'vitest';
import { parseExpression } from '../expression.ts';
import { createProviderDialectRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlDiagnostic, FdqlProjectionItem, FdqlStage } from '../types.ts';
import {
  validateLocalStageExpressions,
  validateProjectionReferences,
} from './expression-validation.ts';

const providers = createProviderDialectRegistry([testProviderDialect]);

describe('FDQL compiler expression validation', () => {
  it('accepts spread projection roots from current row bindings', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateProjectionReferences(
      [spread('stats')],
      {},
      new Set(['stats']),
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
  });

  it('rejects spread projection roots outside current row bindings', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateProjectionReferences(
      [spread('total')],
      {},
      new Set(['stats']),
      providers,
      diagnostics,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_ROW_BINDING' }),
    );
  });

  it('rejects spread projections in local with stages', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateLocalStageExpressions(
      {
        column: 1,
        items: [spread('order')],
        kind: 'with',
        line: 1,
        range: sourceRange(),
      },
      {},
      new Set(['order']),
      providers,
      diagnostics,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SPREAD_PROJECTION' }),
    );
  });

  it('accepts common read expressions in local stages', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateLocalStageExpressions(
      {
        column: 1,
        expression: parse(
          'exists(order.status) and case when order.score + 1 > 10 then true else false end',
        ),
        kind: 'filter',
        line: 1,
        range: sourceRange(),
      },
      {},
      new Set(['order']),
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
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

function sourceRange(): FdqlStage['range'] {
  return { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
}

function parse(source: string) {
  const result = parseExpression(source, 1);
  if (!result.expression) {
    throw new Error(result.diagnostics.map((item) => item.message).join('\n'));
  }
  return result.expression;
}
