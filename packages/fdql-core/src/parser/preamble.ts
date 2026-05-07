import { parseExpression } from '../expression.ts';
import type {
  FdqlAliasDeclaration,
  FdqlDiagnostic,
  FdqlSetDeclaration,
  FdqlSourceRange,
} from '../types.ts';
import { parserError } from './helpers.ts';
import { expressionSlice } from './source-text.ts';

export function parseSet(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlSetDeclaration | null {
  const separator = text.indexOf('=');
  if (separator < 0) {
    diagnostics.push(
      parserError('FDQL_INVALID_SET', '`set` must use `set key = value`.', line, column),
    );
    return null;
  }
  const key = text.slice('set '.length, separator).trim();
  const valueSource = expressionSlice(text, column, separator + 1);
  if (
    (key === 'fdql.timeout' || key === 'fdql.cacheTtl')
    && looksLikeDurationLiteral(valueSource.text)
  ) {
    return { column, key, line, range, rawValue: valueSource.text };
  }
  const parsed = parseExpression(valueSource.text, line, valueSource.column);
  diagnostics.push(...parsed.diagnostics);
  return {
    column,
    key,
    line,
    range,
    rawValue: valueSource.text,
    ...(parsed.expression ? { value: parsed.expression } : {}),
  };
}

export function parseAlias(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlAliasDeclaration | null {
  const separator = text.indexOf('=');
  if (separator < 0) {
    diagnostics.push(
      parserError(
        'FDQL_INVALID_ALIAS_NAME',
        '`alias` must use `alias $name = value`.',
        line,
        column,
      ),
    );
    return null;
  }
  const name = text.slice('alias '.length, separator).trim();
  const valueSource = expressionSlice(text, column, separator + 1);
  const parsed = parseExpression(valueSource.text, line, valueSource.column);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression ? { column, line, name, range, value: parsed.expression } : null;
}

function looksLikeDurationLiteral(value: string): boolean {
  return /^\d+[smhd]$/i.test(value.trim());
}
