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
});

function parse(source: string) {
  const result = parseExpression(source, 1);
  if (!result.expression) {
    throw new Error(result.diagnostics.map((item) => item.message).join('\n'));
  }
  return result.expression;
}
