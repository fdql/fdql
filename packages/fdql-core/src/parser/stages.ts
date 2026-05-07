import { findTopLevelAs, parseExpression, splitTopLevel } from '../expression.ts';
import type {
  FdqlAggregateStage,
  FdqlDiagnostic,
  FdqlFromStage,
  FdqlSourceRange,
  FdqlStage,
} from '../types.ts';
import { parserError, providerFromStatement } from './helpers.ts';
import { parseProjectionItems } from './projection.ts';
import { expressionSlice, type SourceLine } from './source-text.ts';

export function parseProviderClause(
  line: SourceLine,
  diagnostics: FdqlDiagnostic[],
): FdqlStage | null {
  const { column, range, text } = line;
  const provider = providerFromStatement(text);
  if (!provider) return null;
  if (text.startsWith(`${provider} where `)) {
    const prefix = `${provider} where `;
    const expressionSource = expressionSlice(text, column, prefix.length);
    const parsed = parseExpression(expressionSource.text, line.line, expressionSource.column);
    diagnostics.push(...parsed.diagnostics);
    return parsed.expression
      ? {
        column,
        expression: parsed.expression,
        kind: 'providerWhere',
        line: line.line,
        provider,
        range,
      }
      : null;
  }
  if (text.startsWith(`${provider} order by `)) {
    const prefix = `${provider} order by `;
    const sourceBody = expressionSlice(text, column, prefix.length);
    const body = sourceBody.text;
    const direction = body.toLowerCase().endsWith(' desc')
      ? 'desc'
      : body.toLowerCase().endsWith(' asc')
      ? 'asc'
      : 'asc';
    const expressionText = direction === 'asc' && !body.toLowerCase().endsWith(' asc')
      ? body
      : body.slice(0, Math.max(0, body.length - 4)).trim();
    const parsed = parseExpression(expressionText, line.line, sourceBody.column);
    diagnostics.push(...parsed.diagnostics);
    return parsed.expression
      ? {
        column,
        direction,
        expression: parsed.expression,
        kind: 'providerOrderBy',
        line: line.line,
        provider,
        range,
      }
      : null;
  }
  if (text.startsWith(`${provider} limit `)) {
    return {
      column,
      kind: 'providerLimit',
      line: line.line,
      provider,
      range,
      value: Number(text.slice(`${provider} limit `.length).trim()),
    };
  }
  return null;
}

export function parseSortBy(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlStage | null {
  const sourceBody = expressionSlice(text, column, 'then sort by '.length);
  const body = sourceBody.text;
  const direction = body.toLowerCase().endsWith(' desc')
    ? 'desc'
    : body.toLowerCase().endsWith(' asc')
    ? 'asc'
    : 'asc';
  const expressionText = direction === 'asc' && !body.toLowerCase().endsWith(' asc')
    ? body
    : body.slice(0, Math.max(0, body.length - 4)).trim();
  const parsed = parseExpression(expressionText, line, sourceBody.column);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression
    ? { column, direction, expression: parsed.expression, kind: 'sortBy', line, range }
    : null;
}

export function parseAggregate(
  source: string,
  sourceLine: number,
  sourceColumn: number,
  column: number,
  line: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlAggregateStage {
  const normalized = source.replace(/\n/g, ',');
  const groupParts: string[] = [];
  const itemParts: string[] = [];
  let readingGroups = false;
  for (const rawPart of splitTopLevel(normalized)) {
    const part = rawPart.startsWith('by ') ? rawPart.slice(3).trim() : rawPart;
    if (rawPart.startsWith('by ')) readingGroups = true;
    if (readingGroups && !isAggregateProjection(part)) {
      groupParts.push(part);
      continue;
    }
    readingGroups = false;
    itemParts.push(part);
  }
  const groups = parseProjectionItems(groupParts.join(', '), sourceLine, sourceColumn, diagnostics);
  const items = parseProjectionItems(itemParts.join(', '), sourceLine, sourceColumn, diagnostics);
  for (const group of groups) {
    if (!group.alias) {
      diagnostics.push(
        parserError('FDQL_PARSE_ERROR', 'Aggregate `by` expressions need `as`.', line, column),
      );
    }
  }
  for (const item of items) {
    if (!item.alias) {
      diagnostics.push(
        parserError('FDQL_PARSE_ERROR', 'Aggregate expressions need `as`.', line, column),
      );
    }
  }
  return { column, groups, items, kind: 'aggregate', line, range };
}

export function parseUnwind(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlStage | null {
  const body = text.slice('then unwind '.length).trim();
  const aliasIndex = findTopLevelAs(body);
  if (aliasIndex < 0) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        '`unwind` must use `then unwind expression as rowAlias`.',
        line,
        column,
      ),
    );
    return null;
  }
  const expressionText = body.slice(0, aliasIndex).trim();
  const rowAlias = body.slice(aliasIndex + 4).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rowAlias)) {
    diagnostics.push(
      parserError('FDQL_PARSE_ERROR', `Invalid unwind row alias ${rowAlias}.`, line, column),
    );
    return null;
  }
  const expressionSource = expressionSlice(text, column, 'then unwind '.length);
  const parsed = parseExpression(expressionText, line, expressionSource.column);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression
    ? { column, expression: parsed.expression, kind: 'unwind', line, range, rowAlias }
    : null;
}

export function parseFrom(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlFromStage | undefined {
  const match = /^from\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(text);
  if (!match) {
    diagnostics.push(
      parserError('FDQL_PARSE_ERROR', '`from` must use `from $source as rowAlias`.', line, column),
    );
    return undefined;
  }
  return { column, kind: 'from', line, range, rowAlias: match[2]!, sourceAlias: match[1]! };
}

function isAggregateProjection(source: string): boolean {
  return /^(count|sum|avg|min|max)\s*\(/i.test(source.trim());
}
