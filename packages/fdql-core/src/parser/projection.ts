import { findTopLevelAs, parseExpression } from '../expression.ts';
import type {
  FdqlDiagnostic,
  FdqlProjectionItem,
  FdqlProviderAggregateYieldItem,
  FdqlSourceRange,
} from '../types.ts';
import { isStatementStart, parserError } from './helpers.ts';
import { expressionSlice, nameRefAt, type SourceLine, span } from './source-text.ts';

interface ProjectionSourceLocation {
  readonly column: number;
  readonly line: number;
}

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
  readonly sourceLocations: readonly ProjectionSourceLocation[];
} {
  const currentLine = lines[startIndex]!;
  const current = currentLine.text;
  const inlineSource = expressionSlice(current, currentLine.column, keyword.length);
  const inline = inlineSource.text;
  const parts: string[] = inline ? [inline] : [];
  const sourceLocations: ProjectionSourceLocation[] = inline
    ? [{ column: inlineSource.column, line: currentLine.line }]
    : [];
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
    sourceLocations.push({ column: nextLine.column, line: nextLine.line });
    nextIndex = index;
    endRange = nextLine.range;
  }
  const firstLocation = sourceLocations[0];
  return {
    nextIndex,
    range: span(currentLine.range, endRange),
    source: parts.join('\n'),
    sourceColumn: firstLocation?.column ?? currentLine.column,
    sourceLine: firstLocation?.line ?? currentLine.line,
    sourceLocations,
  };
}

export function parseProjectionItems(
  source: string,
  line: number,
  column: number,
  diagnostics: FdqlDiagnostic[],
  sourceLocations?: readonly ProjectionSourceLocation[] | undefined,
): readonly FdqlProjectionItem[] {
  return splitTopLevelProjectionItems(source, line, column, sourceLocations).map((part) => {
    const item = part.text;
    const aliasIndex = findTopLevelAs(item);
    const rawExpressionText = aliasIndex < 0 ? item.trim() : item.slice(0, aliasIndex).trim();
    const spread = rawExpressionText.startsWith('...');
    const expressionText = spread ? rawExpressionText.slice(3).trim() : rawExpressionText;
    const rawAlias = aliasIndex < 0 ? undefined : item.slice(aliasIndex + 4).trim();
    const alias = spread ? undefined : rawAlias;
    const aliasRef = rawAlias
      ? nameRefAt(rawAlias, item, part.line, part.column, aliasIndex + 4)
      : undefined;
    if (spread && aliasIndex >= 0) {
      const errorRange = aliasRef?.range ?? {
        endColumn: part.endColumn,
        endLine: part.endLine,
        startColumn: part.column,
        startLine: part.line,
      };
      diagnostics.push(
        {
          code: 'FDQL_INVALID_SPREAD_PROJECTION',
          column: errorRange.startColumn,
          endColumn: errorRange.endColumn,
          endLine: errorRange.endLine,
          line: errorRange.startLine,
          message: 'Spread return projections cannot use `as alias`.',
          range: errorRange,
          severity: 'error',
        },
      );
    }
    const expressionColumn = part.column + Math.max(0, item.indexOf(expressionText));
    const parsed = parseExpression(expressionText, part.line, expressionColumn);
    diagnostics.push(...parsed.diagnostics);
    return {
      ...(alias ? { alias } : {}),
      ...(aliasRef ? { aliasRef } : {}),
      column: part.column,
      expression: parsed.expression ?? { kind: 'literal', value: null },
      label: expressionText || item,
      line: part.line,
      range: {
        endColumn: part.endColumn,
        endLine: part.endLine,
        startColumn: part.column,
        startLine: part.line,
      },
      ...(spread ? { spread: true } : {}),
    };
  });
}

interface ProjectionPart {
  readonly column: number;
  readonly endColumn: number;
  readonly endLine: number;
  readonly line: number;
  readonly text: string;
}

function splitTopLevelProjectionItems(
  source: string,
  line: number,
  column: number,
  sourceLocations?: readonly ProjectionSourceLocation[] | undefined,
): readonly ProjectionPart[] {
  const parts: ProjectionPart[] = [];
  const positions = sourcePositions(source, line, column, sourceLocations);
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    quote = nextQuote(quote, source, index);
    if (quote) continue;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      pushProjectionPart(parts, source, positions, start, index);
      start = index + 1;
    }
  }
  pushProjectionPart(parts, source, positions, start, source.length);
  return parts;
}

function pushProjectionPart(
  parts: ProjectionPart[],
  source: string,
  positions: readonly ProjectionSourceLocation[],
  start: number,
  end: number,
): void {
  const raw = source.slice(start, end);
  const leading = raw.search(/\S/);
  if (leading < 0) return;
  const trailing = raw.length - raw.trimEnd().length;
  const text = raw.trim();
  const startPosition = positions[start + leading] ?? positions[start];
  const endPosition = positions[Math.max(start + leading, end - trailing)] ?? startPosition;
  if (!startPosition || !endPosition) return;
  parts.push({
    column: startPosition.column,
    endColumn: endPosition.column,
    endLine: endPosition.line,
    line: startPosition.line,
    text,
  });
}

function sourcePositions(
  source: string,
  line: number,
  column: number,
  sourceLocations?: readonly ProjectionSourceLocation[] | undefined,
): readonly ProjectionSourceLocation[] {
  const positions: ProjectionSourceLocation[] = [];
  let lineIndex = 0;
  let currentLine = sourceLocations?.[lineIndex]?.line ?? line;
  let currentColumn = sourceLocations?.[lineIndex]?.column ?? column;
  for (let index = 0; index <= source.length; index += 1) {
    positions[index] = { column: currentColumn, line: currentLine };
    const char = source[index];
    if (char === '\n') {
      lineIndex += 1;
      currentLine = sourceLocations?.[lineIndex]?.line ?? currentLine + 1;
      currentColumn = sourceLocations?.[lineIndex]?.column ?? 1;
    } else {
      currentColumn += 1;
    }
  }
  return positions;
}

function nextQuote(quote: '"' | "'" | null, source: string, index: number): '"' | "'" | null {
  const char = source[index];
  if ((char === '"' || char === "'") && !isEscaped(source, index)) {
    return quote === char ? null : quote ?? char;
  }
  return quote;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export function parseProviderAggregateYieldItems(
  source: string,
  line: number,
  column: number,
  diagnostics: FdqlDiagnostic[],
  sourceLocations?: readonly ProjectionSourceLocation[] | undefined,
): readonly FdqlProviderAggregateYieldItem[] {
  return splitTopLevelProjectionItems(source, line, column, sourceLocations).map((part) => {
    const item = part.text;
    const aliasIndex = findTopLevelAs(item);
    const rawExpressionText = aliasIndex < 0 ? item.trim() : item.slice(0, aliasIndex).trim();
    if (rawExpressionText.startsWith('{') && rawExpressionText.endsWith('}')) {
      const alias = aliasIndex < 0 ? undefined : item.slice(aliasIndex + 4).trim();
      const aliasRef = alias
        ? nameRefAt(alias, item, part.line, part.column, aliasIndex + 4)
        : undefined;
      const inner = rawExpressionText.slice(1, -1).trim();
      if (!alias) {
        diagnostics.push(
          parserError(
            'FDQL_PARSE_ERROR',
            'Aggregate object yield needs `as alias`.',
            line,
            part.column,
          ),
        );
      }
      return {
        ...(alias ? { alias } : {}),
        ...(aliasRef ? { aliasRef } : {}),
        column: part.column,
        items: parseProjectionItems(inner, part.line, part.column + 1, diagnostics),
        kind: 'map',
        label: alias ?? rawExpressionText,
        line: part.line,
        range: {
          endColumn: part.endColumn,
          endLine: part.endLine,
          startColumn: part.column,
          startLine: part.line,
        },
      };
    }
    return {
      item: parseProjectionItems(item, part.line, part.column, diagnostics)[0]!,
      kind: 'flat',
    };
  });
}
