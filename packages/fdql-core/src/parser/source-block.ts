import { parseExpression } from '../expression.ts';
import type { FdqlDiagnostic, FdqlExpression, FdqlNameRef, FdqlSourceRange } from '../types.ts';
import { isProviderClauseStart, isStatementStart } from './helpers.ts';
import { type SourceLine, span } from './source-text.ts';

interface SourcePosition {
  readonly column: number;
  readonly line: number;
}

export interface SourceBlock {
  readonly column: number;
  readonly line: number;
  readonly nextIndex: number;
  readonly positions: readonly SourcePosition[];
  readonly range: FdqlSourceRange;
  readonly text: string;
}

export function collectStatementBlock(
  lines: readonly SourceLine[],
  startIndex: number,
): SourceBlock {
  const start = lines[startIndex]!;
  const chars: string[] = [];
  const positions: SourcePosition[] = [];
  let endRange = start.range;
  let endPosition = { column: start.range.endColumn, line: start.range.endLine };
  let nextIndex = startIndex;

  appendLine(chars, positions, start);
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.text || isStatementStart(line.text) || isProviderClauseBlockStart(lines, index)) {
      break;
    }
    chars.push(' ');
    positions.push(endPosition);
    appendLine(chars, positions, line);
    endRange = line.range;
    endPosition = { column: line.range.endColumn, line: line.range.endLine };
    nextIndex = index;
  }

  positions.push(endPosition);
  return {
    column: start.column,
    line: start.line,
    nextIndex,
    positions,
    range: span(start.range, endRange),
    text: chars.join(''),
  };
}

export function isProviderClauseBlockStart(
  lines: readonly SourceLine[],
  startIndex: number,
): boolean {
  const text = lines[startIndex]?.text ?? '';
  if (isProviderClauseStart(text)) return true;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return false;
  const nextText = lines[startIndex + 1]?.text ?? '';
  return /^(where|limit)\b/i.test(nextText) || /^order(?:\s+by)?\b/i.test(nextText);
}

export function sourceBlockSlice(
  block: SourceBlock,
  startIndex: number,
  endIndex = block.text.length,
): SourceBlock {
  const start = clamp(startIndex, 0, block.text.length);
  const end = clamp(endIndex, start, block.text.length);
  const range = rangeInSourceBlock(block, start, end - start);
  return {
    column: range.startColumn,
    line: range.startLine,
    nextIndex: block.nextIndex,
    positions: block.positions.slice(start, end + 1),
    range,
    text: block.text.slice(start, end),
  };
}

export function trimSourceBlock(block: SourceBlock): SourceBlock {
  const leading = block.text.search(/\S/);
  if (leading < 0) return sourceBlockSlice(block, 0, 0);
  const trailing = block.text.length - block.text.trimEnd().length;
  return sourceBlockSlice(block, leading, block.text.length - trailing);
}

export function expressionBlockSlice(block: SourceBlock, startIndex: number): SourceBlock {
  return trimSourceBlock(sourceBlockSlice(block, startIndex));
}

export function rangeInSourceBlock(
  block: SourceBlock,
  startIndex: number,
  length: number,
): FdqlSourceRange {
  const start = clamp(startIndex, 0, block.text.length);
  const end = clamp(start + Math.max(0, length), start, block.text.length);
  const startPosition = block.positions[start] ?? block.positions[0] ?? {
    column: block.column,
    line: block.line,
  };
  const endPosition = block.positions[end] ?? startPosition;
  return {
    endColumn: endPosition.column,
    endLine: endPosition.line,
    startColumn: startPosition.column,
    startLine: startPosition.line,
  };
}

export function nameRefInSourceBlock(
  name: string,
  block: SourceBlock,
  startIndex = 0,
): FdqlNameRef {
  const index = block.text.indexOf(name, Math.max(0, startIndex));
  return {
    name,
    range: rangeInSourceBlock(block, index < 0 ? startIndex : index, name.length),
  };
}

export function parseExpressionBlock(
  block: SourceBlock,
): { readonly diagnostics: readonly FdqlDiagnostic[]; readonly expression?: FdqlExpression; } {
  const parsed = parseExpression(block.text, 1, 1);
  return {
    diagnostics: parsed.diagnostics.map((diagnostic) => remapDiagnostic(diagnostic, block)),
    ...(parsed.expression ? { expression: remapExpression(parsed.expression, block) } : {}),
  };
}

function appendLine(chars: string[], positions: SourcePosition[], line: SourceLine): void {
  for (let index = 0; index < line.text.length; index += 1) {
    chars.push(line.text[index]!);
    positions.push({ column: line.column + index, line: line.line });
  }
}

function remapDiagnostic(diagnostic: FdqlDiagnostic, block: SourceBlock): FdqlDiagnostic {
  const range = diagnostic.range
    ? remapRange(diagnostic.range, block)
    : diagnostic.column
    ? rangeInSourceBlock(
      block,
      diagnostic.column - 1,
      Math.max(1, (diagnostic.endColumn ?? diagnostic.column + 1) - diagnostic.column),
    )
    : undefined;
  if (!range) return diagnostic;
  return {
    ...diagnostic,
    column: range.startColumn,
    endColumn: range.endColumn,
    endLine: range.endLine,
    line: range.startLine,
    range,
  };
}

function remapExpression(expression: FdqlExpression, block: SourceBlock): FdqlExpression {
  const range = expression.range ? remapRange(expression.range, block) : undefined;
  if (expression.kind === 'array') {
    return {
      ...expression,
      items: expression.items.map((item) => remapExpression(item, block)),
      ...(range ? { range } : {}),
    };
  }
  if (expression.kind === 'binary') {
    return {
      ...expression,
      left: remapExpression(expression.left, block),
      ...(range ? { range } : {}),
      right: remapExpression(expression.right, block),
    };
  }
  if (expression.kind === 'call') {
    return {
      ...expression,
      args: expression.args.map((arg) => remapExpression(arg, block)),
      ...(expression.nameRange ? { nameRange: remapRange(expression.nameRange, block) } : {}),
      ...(range ? { range } : {}),
    };
  }
  if (expression.kind === 'case') {
    return {
      ...expression,
      branches: expression.branches.map((branch) => ({
        condition: remapExpression(branch.condition, block),
        value: remapExpression(branch.value, block),
      })),
      ...(expression.elseExpression
        ? { elseExpression: remapExpression(expression.elseExpression, block) }
        : {}),
      ...(range ? { range } : {}),
    };
  }
  if (expression.kind === 'map') {
    return {
      ...expression,
      entries: expression.entries.map((entry) => ({
        key: entry.key,
        value: remapExpression(entry.value, block),
      })),
      ...(range ? { range } : {}),
    };
  }
  if (expression.kind === 'postfix' || expression.kind === 'unary') {
    return {
      ...expression,
      expression: remapExpression(expression.expression, block),
      ...(range ? { range } : {}),
    };
  }
  return { ...expression, ...(range ? { range } : {}) };
}

function remapRange(range: FdqlSourceRange, block: SourceBlock): FdqlSourceRange {
  return rangeInSourceBlock(
    block,
    range.startColumn - 1,
    Math.max(0, range.endColumn - range.startColumn),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
