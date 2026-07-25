import type { FdqlNameRef, FdqlSourceRange } from '../types.ts';

export interface SourceLine {
  readonly column: number;
  readonly line: number;
  readonly range: FdqlSourceRange;
  readonly text: string;
}

export function createSourceLines(source: string): readonly SourceLine[] {
  return source.split(/\r?\n/).map((text, index) => {
    const withoutComment = stripComment(text);
    const trimmed = withoutComment.trim();
    const indent = firstNonWhitespaceIndex(withoutComment);
    const column = indent + 1;
    return {
      column,
      line: index + 1,
      range: {
        endColumn: column + trimmed.length,
        endLine: index + 1,
        startColumn: column,
        startLine: index + 1,
      },
      text: trimmed,
    };
  });
}

export function splitUnionAll(source: string): readonly string[] {
  const parts: string[] = [];
  const lines = source.split(/\r?\n/);
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().toLowerCase() === 'union all') {
      parts.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  parts.push(current.join('\n').trim());
  return parts.filter(Boolean);
}

export function sharedPreamble(source: string): string {
  const lines = source.split(/\r?\n/);
  const preamble: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      preamble.push(line);
      continue;
    }
    if (trimmed === 'from' || trimmed.startsWith('from ')) break;
    preamble.push(line);
  }
  return preamble.join('\n').trim();
}

export function expressionSlice(
  text: string,
  statementColumn: number,
  startIndex: number,
): { readonly column: number; readonly text: string; } {
  const raw = text.slice(startIndex);
  const leading = firstNonWhitespaceIndex(raw);
  return { column: statementColumn + startIndex + leading, text: raw.trim() };
}

export function span(start: FdqlSourceRange, end: FdqlSourceRange): FdqlSourceRange {
  return {
    endColumn: end.endColumn,
    endLine: end.endLine,
    startColumn: start.startColumn,
    startLine: start.startLine,
  };
}

export function rangeAt(
  line: number,
  column: number,
  startIndex: number,
  length: number,
): FdqlSourceRange {
  const startColumn = column + startIndex;
  return {
    endColumn: startColumn + length,
    endLine: line,
    startColumn,
    startLine: line,
  };
}

export function nameRefAt(
  name: string,
  text: string,
  line: number,
  column: number,
  startIndex = 0,
): FdqlNameRef {
  const index = text.indexOf(name, Math.max(0, startIndex));
  return {
    name,
    range: rangeAt(line, column, index < 0 ? startIndex : index, name.length),
  };
}

function firstNonWhitespaceIndex(text: string): number {
  const index = text.search(/\S/);
  return index < 0 ? 0 : index;
}

function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  let marker = -1;
  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && !isEscaped(line, index)) {
      quote = quote === char ? null : quote ?? char;
    }
    if (!quote && char === '/' && line[index + 1] === '/') {
      marker = index;
      break;
    }
  }
  return marker < 0 ? line : line.slice(0, marker);
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
