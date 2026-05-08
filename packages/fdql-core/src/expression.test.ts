import { describe, expect, it } from 'vitest';
import { parseExpression } from './expression.ts';

describe('FDQL expression parser', () => {
  it('parses math with comparison precedence', () => {
    const expression = parse('score + bonus * 2 >= 10');

    expect(expression).toMatchObject({
      kind: 'binary',
      left: {
        kind: 'binary',
        operator: '+',
        right: { kind: 'binary', operator: '*' },
      },
      operator: '>=',
    });
  });

  it('parses null and missing predicates', () => {
    expect(parse('driver.deletedAt is null')).toMatchObject({
      kind: 'postfix',
      operator: 'is null',
    });
    expect(parse('driver.deletedAt is not missing')).toMatchObject({
      kind: 'postfix',
      operator: 'is not missing',
    });
  });

  it('parses not in as one comparison operator', () => {
    expect(parse('driver.status not in ["deleted", "archived"]')).toMatchObject({
      kind: 'binary',
      operator: 'not in',
    });
  });

  it('parses searched case expressions with ranges', () => {
    const expression = parse('case when score > 10 then "podium" else "field" end', 3, 7);

    expect(expression).toMatchObject({
      branches: [{ condition: { kind: 'binary', operator: '>' }, value: { value: 'podium' } }],
      elseExpression: { value: 'field' },
      kind: 'case',
      range: { startColumn: 7, startLine: 3 },
    });
  });

  it('reports malformed case expressions', () => {
    const result = parseExpression('case else "x" end', 1);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FDQL_PARSE_ERROR',
        message: 'Case expression needs at least one when branch.',
      }),
    );
  });
});

function parse(source: string, line = 1, column = 1) {
  const result = parseExpression(source, line, column);
  if (!result.expression) {
    throw new Error(result.diagnostics.map((item) => item.message).join('\n'));
  }
  return result.expression;
}
