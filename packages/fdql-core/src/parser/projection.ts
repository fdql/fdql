import { findTopLevelAs, parseExpression, splitTopLevel } from '../expression.ts';
import type { FdqlDiagnostic, FdqlProjectionItem, FdqlSourceRange } from '../types.ts';
import { isStatementStart } from './helpers.ts';
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
    const expressionText = aliasIndex < 0 ? item.trim() : item.slice(0, aliasIndex).trim();
    const alias = aliasIndex < 0 ? undefined : item.slice(aliasIndex + 4).trim();
    const parsed = parseExpression(expressionText, line, column);
    diagnostics.push(...parsed.diagnostics);
    return {
      ...(alias ? { alias } : {}),
      column,
      expression: parsed.expression ?? { kind: 'literal', value: null },
      label: item,
      line,
      range: {
        endColumn: column + item.length,
        endLine: line,
        startColumn: column,
        startLine: line,
      },
    };
  });
}
