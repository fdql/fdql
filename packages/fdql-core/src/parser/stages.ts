import { findTopLevelAs, parseExpression } from '../expression.ts';
import type {
  FdqlAggregateFromStage,
  FdqlAggregateStage,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlFromStage,
  FdqlLookupClause,
  FdqlProjectionItem,
  FdqlSourceRange,
  FdqlStage,
} from '../types.ts';
import {
  isProviderClauseStart,
  isStatementStart,
  parserError,
  providerFromStatement,
} from './helpers.ts';
import { collectProjection, parseProjectionItems } from './projection.ts';
import { expressionSlice, type SourceLine, span } from './source-text.ts';

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

export function parseAggregateStage(
  lines: readonly SourceLine[],
  startIndex: number,
  diagnostics: FdqlDiagnostic[],
): { readonly nextIndex: number; readonly stage: FdqlAggregateStage; } {
  const start = lines[startIndex]!;
  const block = collectAggregateBody(lines, startIndex, 'then aggregate');
  const groups = parseProjectionItems(
    block.groups.join(', '),
    block.line,
    block.column,
    diagnostics,
  );
  const items = parseProjectionItems(
    block.yields.join(', '),
    block.line,
    block.column,
    diagnostics,
  );
  if (!block.yields.length) {
    diagnostics.push(
      parserError('FDQL_PARSE_ERROR', 'Aggregate blocks need `yield`.', start.line, start.column),
    );
  }
  for (const group of groups) {
    if (!group.alias) {
      diagnostics.push(
        parserError(
          'FDQL_PARSE_ERROR',
          'Aggregate `by` expressions need `as`.',
          start.line,
          start.column,
        ),
      );
    }
  }
  for (const item of items) {
    if (!item.alias) {
      diagnostics.push(
        parserError(
          'FDQL_PARSE_ERROR',
          'Aggregate `yield` expressions need `as`.',
          start.line,
          start.column,
        ),
      );
    }
  }
  return {
    nextIndex: block.nextIndex,
    stage: {
      column: start.column,
      groups,
      items,
      kind: 'aggregate',
      line: start.line,
      range: span(start.range, block.range),
    },
  };
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

export function parseAggregateFrom(
  lines: readonly SourceLine[],
  startIndex: number,
  diagnostics: FdqlDiagnostic[],
): { readonly from?: FdqlAggregateFromStage | undefined; readonly nextIndex: number; } | null {
  const start = lines[startIndex]!;
  const header = parseAggregateFromHeader(start, diagnostics);
  if (!header) return null;
  const clauses: FdqlLookupClause[] = [];
  let yieldItems: readonly FdqlProjectionItem[] | undefined;
  let nextIndex = startIndex;
  let endRange = start.range;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.text) {
      nextIndex = index;
      endRange = line.range;
      continue;
    }
    if (isProviderClauseStart(line.text)) {
      const clause = parseProviderClause(line, diagnostics);
      if (
        clause
        && (
          clause.kind === 'providerLimit' || clause.kind === 'providerOrderBy'
          || clause.kind === 'providerWhere'
        )
      ) {
        clauses.push(clause);
      }
      nextIndex = index;
      endRange = line.range;
      continue;
    }
    if (line.text === 'yield' || line.text.startsWith('yield ')) {
      if (yieldItems) {
        diagnostics.push(
          parserError(
            'FDQL_DUPLICATE_STAGE',
            'Provider aggregate supports one `yield`.',
            line.line,
            line.column,
          ),
        );
      }
      const block = collectProjection(lines, index, 'yield');
      yieldItems = parseProjectionItems(
        block.source,
        block.sourceLine,
        block.sourceColumn,
        diagnostics,
      );
      index = block.nextIndex;
      nextIndex = block.nextIndex;
      endRange = block.range;
      continue;
    }
    break;
  }
  return {
    from: {
      clauses,
      column: start.column,
      kind: 'from',
      line: start.line,
      mode: 'aggregate',
      provider: header.provider,
      ...(header.providerRowAlias ? { providerRowAlias: header.providerRowAlias } : {}),
      range: span(start.range, endRange),
      sourceAlias: header.sourceAlias,
      ...(header.sourceExpression ? { sourceExpression: header.sourceExpression } : {}),
      ...(yieldItems ? { yieldItems } : {}),
    },
    nextIndex,
  };
}

function collectAggregateBody(
  lines: readonly SourceLine[],
  startIndex: number,
  keyword: string,
): {
  readonly column: number;
  readonly groups: readonly string[];
  readonly line: number;
  readonly nextIndex: number;
  readonly range: FdqlSourceRange;
  readonly yields: readonly string[];
} {
  const start = lines[startIndex]!;
  const groups: string[] = [];
  const yields: string[] = [];
  let mode: 'by' | 'yield' | undefined;
  let nextIndex = startIndex;
  let endRange = start.range;
  const inline = expressionSlice(start.text, start.column, keyword.length).text;
  const allLines = inline ? [{ ...start, text: inline }] : [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.text) {
      nextIndex = index;
      endRange = line.range;
      continue;
    }
    if (isStatementStart(line.text) && !isAggregateBodyLine(line.text)) break;
    allLines.push(line);
    nextIndex = index;
    endRange = line.range;
  }
  for (const line of allLines) {
    if (line.text.startsWith('by ')) {
      mode = 'by';
      groups.push(line.text.slice('by '.length).trim());
      continue;
    }
    if (line.text === 'yield' || line.text.startsWith('yield ')) {
      mode = 'yield';
      yields.push(line.text.slice('yield'.length).trim());
      continue;
    }
    if (mode === 'by') groups.push(line.text);
    else if (mode === 'yield') yields.push(line.text);
  }
  return {
    column: start.column,
    groups,
    line: start.line,
    nextIndex,
    range: endRange,
    yields,
  };
}

function isAggregateBodyLine(text: string): boolean {
  return text.startsWith('by ') || text === 'yield' || text.startsWith('yield ');
}

function parseAggregateFromHeader(
  line: SourceLine,
  diagnostics: FdqlDiagnostic[],
):
  | {
    readonly provider: string;
    readonly providerRowAlias?: string | undefined;
    readonly sourceAlias: string;
    readonly sourceExpression?: FdqlExpression | undefined;
  }
  | null
{
  const match = /^from\s+([A-Za-z_][A-Za-z0-9_]*)\.aggregate\((.*)\)$/i.exec(line.text);
  if (!match) return null;
  const provider = match[1]!;
  const body = match[2]!.trim();
  const aliasIndex = findTopLevelAs(body);
  const sourceText = (aliasIndex < 0 ? body : body.slice(0, aliasIndex)).trim();
  const providerRowAlias = aliasIndex < 0 ? undefined : body.slice(aliasIndex + 4).trim();
  if (!sourceText) {
    diagnostics.push(
      parserError('FDQL_PARSE_ERROR', '`fs.aggregate` needs a source.', line.line, line.column),
    );
    return null;
  }
  if (providerRowAlias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(providerRowAlias)) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        `Invalid aggregate row alias ${providerRowAlias}.`,
        line.line,
        line.column,
      ),
    );
    return null;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(sourceText)) {
    return {
      provider,
      ...(providerRowAlias ? { providerRowAlias } : {}),
      sourceAlias: sourceText,
    };
  }
  const parsed = parseExpression(
    sourceText,
    line.line,
    line.column + line.text.indexOf(sourceText),
  );
  diagnostics.push(...parsed.diagnostics);
  return {
    provider,
    ...(providerRowAlias ? { providerRowAlias } : {}),
    sourceAlias: sourceText,
    ...(parsed.expression ? { sourceExpression: parsed.expression } : {}),
  };
}
