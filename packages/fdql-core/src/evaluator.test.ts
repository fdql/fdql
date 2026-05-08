import { describe, expect, it } from 'vitest';
import { evaluateExpression } from './evaluator.ts';
import { parseExpression } from './expression.ts';
import {
  bytesValue,
  geoPointValue,
  mapValue,
  missingValue,
  nullValue,
  numberValue,
  stringValue,
  timestampValue,
} from './value.ts';

describe('FDQL evaluator', () => {
  it('returns missing for absent fields and map keys', () => {
    expect(
      evaluateExpression(parse('d.missing'), {
        rows: { d: { firstName: stringValue('Vini') } },
      }),
    ).toEqual(missingValue);
    expect(
      evaluateExpression(parse('mapGet(d.metadata, "unknown")'), {
        rows: { d: { metadata: mapValue({ known: numberValue(1) }) } },
      }),
    ).toEqual(missingValue);
  });

  it('returns null for null row bindings', () => {
    expect(
      evaluateExpression(parse('team'), {
        rows: { team: null },
      }),
    ).toEqual(nullValue);
    expect(
      evaluateExpression(parse('team.name'), {
        rows: { team: null },
      }),
    ).toEqual(missingValue);
  });

  it('constructs core typed values', () => {
    expect(evaluateExpression(parse('timestamp("2026-01-01T00:00:00.000Z")'))).toEqual(
      timestampValue('2026-01-01T00:00:00.000Z'),
    );
    expect(evaluateExpression(parse('bytes("base64:SGVsbG8=")'))).toEqual(bytesValue('SGVsbG8='));
    expect(evaluateExpression(parse('geoPoint(-37.8136, 144.9631)'))).toEqual(
      geoPointValue(-37.8136, 144.9631),
    );
  });

  it('evaluates null and missing predicates', () => {
    const rows = { d: { deletedAt: nullValue, name: stringValue('Vini') } };

    expect(evaluateExpression(parse('d.deletedAt is null'), { rows })).toEqual(boolean(true));
    expect(evaluateExpression(parse('d.deletedAt is not null'), { rows })).toEqual(boolean(false));
    expect(evaluateExpression(parse('d.name is not missing'), { rows })).toEqual(boolean(true));
    expect(evaluateExpression(parse('d.unknown is missing'), { rows })).toEqual(boolean(true));
  });

  it('evaluates exists and missing helpers', () => {
    const rows = { d: { deletedAt: nullValue, name: stringValue('Vini') } };

    expect(evaluateExpression(parse('exists(d.deletedAt)'), { rows })).toEqual(boolean(true));
    expect(evaluateExpression(parse('missing(d.deletedAt)'), { rows })).toEqual(boolean(false));
    expect(evaluateExpression(parse('missing(d.unknown)'), { rows })).toEqual(boolean(true));
  });

  it('evaluates not in comparisons', () => {
    const rows = { d: { status: stringValue('paid') } };

    expect(evaluateExpression(parse('d.status not in ["draft", "void"]'), { rows })).toEqual(
      boolean(true),
    );
    expect(evaluateExpression(parse('d.status not in ["paid", "void"]'), { rows })).toEqual(
      boolean(false),
    );
  });

  it('evaluates searched case expressions', () => {
    const rows = { d: { score: numberValue(12) } };

    expect(
      evaluateExpression(
        parse('case when d.score > 10 then "podium" when d.score > 0 then "points" end'),
        { rows },
      ),
    ).toEqual(stringValue('podium'));
    expect(evaluateExpression(parse('case when d.score < 0 then "bad" end'), { rows })).toEqual(
      nullValue,
    );
  });

  it('evaluates numeric math only', () => {
    const rows = {
      d: { bonus: numberValue(2), name: stringValue('Vini'), score: numberValue(12) },
    };

    expect(evaluateExpression(parse('d.score + d.bonus * 3'), { rows })).toEqual(numberValue(18));
    expect(evaluateExpression(parse('-d.score / 3'), { rows })).toEqual(numberValue(-4));
    expect(evaluateExpression(parse('d.score % 5'), { rows })).toEqual(numberValue(2));
    expect(evaluateExpression(parse('d.score / 0'), { rows })).toEqual(missingValue);
    expect(evaluateExpression(parse('d.name + 1'), { rows })).toEqual(missingValue);
  });
});

function parse(source: string) {
  const result = parseExpression(source, 1);
  if (!result.expression) {
    throw new Error(result.diagnostics.map((item) => item.message).join('\n'));
  }
  return result.expression;
}

function boolean(value: boolean) {
  return { kind: 'boolean' as const, value };
}
