import { findTopLevelAs, parseExpression, splitTopLevel } from '../expression.ts';
import type {
  FdqlDiagnostic,
  FdqlProjectionItem,
  FdqlProviderAggregateYieldItem,
  FdqlSourceRange,
} from '../types.ts';
import { isStatementStart, parserError } from './helpers.ts';
import { expressionSlice, type SourceLine, span } from './source-text.ts';

export function collectProjection(
  lines: readonly SourceLine[],
  startIndex: number,
  keyword: string,
): {
  readonly nextIndex: number;
  readonly range: FdqlSourceRange;
  readonly source: string;
  readonly sourceColumn: number;
  readonly sourceLine: number;
} {
  const currentLine = lines[startIndex]!;
  const current = currentLine.text;
  const inlineSource = expressionSlice(current, currentLine.column, keyword.length);
  const inline = inlineSource.text;
  const parts: string[] = inline ? [inline] : [];
  let nextIndex = startIndex;
  let endRange = currentLine.range;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const nextLine = lines[index]!;
    const text = nextLine.text;
    if (!text) {
      nextIndex = index;
      endRange = nextLine.range;
      continue;
    }
    if (isStatementStart(text)) break;
    parts.push(text);
    nextIndex = index;
    endRange = nextLine.range;
  }
  return {
    nextIndex,
    range: span(currentLine.range, endRange),
    source: parts.join('\n'),
    sourceColumn: inline ? inlineSource.column : currentLine.column,
    sourceLine: inline ? currentLine.line : lines[startIndex + 1]?.line ?? currentLine.line,
  };
}

export function parseProjectionItems(
  source: string,
  line: number,
  column: number,
  diagnostics: FdqlDiagnostic[],
): readonly FdqlProjectionItem[] {
  return splitTopLevel(source.replace(/\n/g, ',')).map((item) => {
    const aliasIndex = findTopLevelAs(item);
    const rawExpressionText = aliasIndex < 0 ? item.trim() : item.slice(0, aliasIndex).trim();
    const spread = rawExpressionText.startsWith('...');
    const expressionText = spread ? rawExpressionText.slice(3).trim() : rawExpressionText;
    const alias = aliasIndex < 0 || spread ? undefined : item.slice(aliasIndex + 4).trim();
    if (spread && aliasIndex >= 0) {
      diagnostics.push(
        parserError(
          'FDQL_INVALID_SPREAD_PROJECTION',
          'Spread return projections cannot use `as alias`.',
          line,
          column,
        ),
      );
    }
    const parsed = parseExpression(expressionText, line, column);
    diagnostics.push(...parsed.diagnostics);
    return {
      ...(alias ? { alias } : {}),
      column,
      expression: parsed.expression ?? { kind: 'literal', value: null },
      label: expressionText || item,
      line,
      range: {
        endColumn: column + item.length,
        endLine: line,
        startColumn: column,
        startLine: line,
      },
      ...(spread ? { spread: true } : {}),
    };
  });
}

export function parseProviderAggregateYieldItems(
  source: string,
  line: number,
  column: number,
  diagnostics: FdqlDiagnostic[],
): readonly FdqlProviderAggregateYieldItem[] {
  return splitTopLevel(source.replace(/\n/g, ',')).map((item) => {
    const aliasIndex = findTopLevelAs(item);
    const rawExpressionText = aliasIndex < 0 ? item.trim() : item.slice(0, aliasIndex).trim();
    if (rawExpressionText.startsWith('{') && rawExpressionText.endsWith('}')) {
      const alias = aliasIndex < 0 ? undefined : item.slice(aliasIndex + 4).trim();
      const inner = rawExpressionText.slice(1, -1).trim();
      if (!alias) {
        diagnostics.push(
          parserError(
            'FDQL_PARSE_ERROR',
            'Aggregate object yield needs `as alias`.',
            line,
            column,
          ),
        );
      }
      return {
        ...(alias ? { alias } : {}),
        column,
        items: parseProjectionItems(inner, line, column + 1, diagnostics),
        kind: 'map',
        label: alias ?? rawExpressionText,
        line,
        range: {
          endColumn: column + item.length,
          endLine: line,
          startColumn: column,
          startLine: line,
        },
      };
    }
    return { item: parseProjectionItems(item, line, column, diagnostics)[0]!, kind: 'flat' };
  });
}
