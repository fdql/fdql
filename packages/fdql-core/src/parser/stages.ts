import { findTopLevelAs } from '../expression.ts';
import type {
  FdqlAggregateFromStage,
  FdqlAggregateStage,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlFromStage,
  FdqlLookupClause,
  FdqlNameRef,
  FdqlProviderAggregateStage,
  FdqlProviderAggregateYieldItem,
  FdqlSourceRange,
  FdqlStage,
} from '../types.ts';
import { isStatementStart, parserError, providerFromStatement } from './helpers.ts';
import {
  collectProjection,
  parseProjectionItems,
  parseProviderAggregateYieldItems,
} from './projection.ts';
import {
  collectStatementBlock,
  expressionBlockSlice,
  isProviderClauseBlockStart,
  nameRefInSourceBlock,
  parseExpressionBlock,
  rangeInSourceBlock,
  type SourceBlock,
  sourceBlockSlice,
  trimSourceBlock,
} from './source-block.ts';
import { expressionSlice, type SourceLine, span } from './source-text.ts';

export function parseProviderClause(
  block: SourceBlock,
  diagnostics: FdqlDiagnostic[],
): FdqlStage | null {
  const { column, range, text } = block;
  const provider = providerFromStatement(text);
  if (!provider) return null;
  const providerRef = nameRefInSourceBlock(provider, block);
  if (text.startsWith(`${provider} where `)) {
    const prefix = `${provider} where `;
    const parsed = parseExpressionBlock(expressionBlockSlice(block, prefix.length));
    diagnostics.push(...parsed.diagnostics);
    return parsed.expression
      ? {
        column,
        expression: parsed.expression,
        kind: 'providerWhere',
        line: block.line,
        provider,
        providerRef,
        range,
      }
      : null;
  }
  if (text.startsWith(`${provider} order by `)) {
    const prefix = `${provider} order by `;
    const sourceBody = expressionBlockSlice(block, prefix.length);
    const body = sourceBody.text;
    const direction = body.toLowerCase().endsWith(' desc')
      ? 'desc'
      : body.toLowerCase().endsWith(' asc')
      ? 'asc'
      : 'asc';
    const expressionBlock = direction === 'asc' && !body.toLowerCase().endsWith(' asc')
      ? sourceBody
      : trimSourceBlock(sourceBlockSlice(sourceBody, 0, Math.max(0, body.length - 4)));
    const parsed = parseExpressionBlock(expressionBlock);
    diagnostics.push(...parsed.diagnostics);
    return parsed.expression
      ? {
        column,
        direction,
        expression: parsed.expression,
        kind: 'providerOrderBy',
        line: block.line,
        provider,
        providerRef,
        range,
      }
      : null;
  }
  if (text.startsWith(`${provider} limit `)) {
    return {
      column,
      kind: 'providerLimit',
      line: block.line,
      provider,
      providerRef,
      range,
      value: Number(text.slice(`${provider} limit `.length).trim()),
    };
  }
  return null;
}

export function parseSortBy(
  block: SourceBlock,
  diagnostics: FdqlDiagnostic[],
): FdqlStage | null {
  const sourceBody = expressionBlockSlice(block, 'then sort by '.length);
  const body = sourceBody.text;
  const direction = body.toLowerCase().endsWith(' desc')
    ? 'desc'
    : body.toLowerCase().endsWith(' asc')
    ? 'asc'
    : 'asc';
  const expressionBlock = direction === 'asc' && !body.toLowerCase().endsWith(' asc')
    ? sourceBody
    : trimSourceBlock(sourceBlockSlice(sourceBody, 0, Math.max(0, body.length - 4)));
  const parsed = parseExpressionBlock(expressionBlock);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression
    ? {
      column: block.column,
      direction,
      expression: parsed.expression,
      kind: 'sortBy',
      line: block.line,
      range: block.range,
    }
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
  block: SourceBlock,
  diagnostics: FdqlDiagnostic[],
): FdqlStage | null {
  const bodyBlock = expressionBlockSlice(block, 'then unwind '.length);
  const body = bodyBlock.text;
  const aliasIndex = findTopLevelAs(body);
  if (aliasIndex < 0) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        '`unwind` must use `then unwind expression as rowAlias`.',
        block.line,
        block.column,
      ),
    );
    return null;
  }
  const expressionBlock = trimSourceBlock(sourceBlockSlice(bodyBlock, 0, aliasIndex));
  const rowAliasBlock = trimSourceBlock(sourceBlockSlice(bodyBlock, aliasIndex + 4));
  const rowAlias = rowAliasBlock.text;
  const rowAliasRef = nameRefInSourceBlock(rowAlias, rowAliasBlock);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rowAlias)) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        `Invalid unwind row alias ${rowAlias}.`,
        block.line,
        block.column,
        rowAliasRef.range,
      ),
    );
    return null;
  }
  const parsed = parseExpressionBlock(expressionBlock);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression
    ? {
      column: block.column,
      expression: parsed.expression,
      kind: 'unwind',
      line: block.line,
      range: block.range,
      rowAlias,
      rowAliasRef,
    }
    : null;
}

export function parseFrom(
  block: SourceBlock,
  diagnostics: FdqlDiagnostic[],
): FdqlFromStage | undefined {
  const { column, line, range, text } = block;
  const match = /^from\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(text);
  if (!match) {
    const invalidAlias = /^from\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s+as\s+(.+)$/i.exec(text);
    if (invalidAlias) {
      const alias = invalidAlias[2]!.trim();
      diagnostics.push(
        parserError(
          'FDQL_PARSE_ERROR',
          '`from` row alias must be an identifier.',
          line,
          column,
          nameRefInSourceBlock(alias, block, text.indexOf(' as ') + 4).range,
        ),
      );
      return undefined;
    }
    const sourceOnly = /^from\s+(\$[A-Za-z_][A-Za-z0-9_]*)$/i.exec(text);
    if (sourceOnly) {
      diagnostics.push(
        parserError(
          'FDQL_PARSE_ERROR',
          '`from` must use `from $source as rowAlias`.',
          line,
          column,
          rangeInSourceBlock(block, text.length, 1),
        ),
      );
      return undefined;
    }
    const sourceCandidate = /^from\s+(\S+)/i.exec(text);
    const errorRange = sourceCandidate
      ? nameRefInSourceBlock(sourceCandidate[1]!, block, 'from '.length).range
      : range;
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        '`from` must use `from $source as rowAlias`.',
        line,
        column,
        errorRange,
      ),
    );
    return undefined;
  }
  const sourceAlias = match[1]!;
  const rowAlias = match[2]!;
  return {
    column,
    kind: 'from',
    line,
    range,
    rowAlias,
    rowAliasRef: nameRefInSourceBlock(rowAlias, block, text.indexOf(' as ') + 4),
    sourceAlias,
    sourceAliasRef: nameRefInSourceBlock(sourceAlias, block, 'from '.length),
  };
}

export function parseAggregateFrom(
  lines: readonly SourceLine[],
  startIndex: number,
  diagnostics: FdqlDiagnostic[],
): { readonly from?: FdqlAggregateFromStage | undefined; readonly nextIndex: number; } | null {
  const start = lines[startIndex]!;
  const headerBlock = collectStatementBlock(lines, startIndex);
  const header = parseAggregateFromHeader(headerBlock, diagnostics);
  if (!header) return null;
  const clauses: FdqlLookupClause[] = [];
  let yieldItems: readonly FdqlProviderAggregateYieldItem[] | undefined;
  let nextIndex = headerBlock.nextIndex;
  let endRange = headerBlock.range;
  for (let index = headerBlock.nextIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.text) {
      nextIndex = index;
      endRange = line.range;
      continue;
    }
    if (isProviderClauseBlockStart(lines, index)) {
      const clauseBlock = collectStatementBlock(lines, index);
      const clause = parseProviderClause(clauseBlock, diagnostics);
      if (
        clause
        && (
          clause.kind === 'providerLimit' || clause.kind === 'providerOrderBy'
          || clause.kind === 'providerWhere'
        )
      ) {
        clauses.push(clause);
      }
      index = clauseBlock.nextIndex;
      nextIndex = clauseBlock.nextIndex;
      endRange = clauseBlock.range;
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
      yieldItems = parseProviderAggregateYieldItems(
        block.source,
        block.sourceLine,
        block.sourceColumn,
        diagnostics,
        block.sourceLocations,
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
      ...(header.providerRef ? { providerRef: header.providerRef } : {}),
      ...(header.providerRowAlias ? { providerRowAlias: header.providerRowAlias } : {}),
      ...(header.providerRowAliasRef ? { providerRowAliasRef: header.providerRowAliasRef } : {}),
      range: span(start.range, endRange),
      sourceAlias: header.sourceAlias,
      ...(header.sourceAliasRef ? { sourceAliasRef: header.sourceAliasRef } : {}),
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
  block: SourceBlock,
  diagnostics: FdqlDiagnostic[],
):
  | {
    readonly provider: string;
    readonly providerRef?: FdqlNameRef | undefined;
    readonly providerRowAlias?: string | undefined;
    readonly providerRowAliasRef?: FdqlNameRef | undefined;
    readonly sourceAlias: string;
    readonly sourceAliasRef?: FdqlNameRef | undefined;
    readonly sourceExpression?: FdqlExpression | undefined;
  }
  | null
{
  const match = /^from\s+([A-Za-z_][A-Za-z0-9_]*)\.aggregate\b/i.exec(block.text);
  if (!match) return null;
  const provider = match[1]!;
  const providerRef = nameRefInSourceBlock(provider, block, 'from '.length);
  const bodyBlock = expressionBlockSlice(block, match[0].length);
  const body = bodyBlock.text;
  const ofIndex = findTopLevelKeyword(body, 'of');
  if (ofIndex >= 0) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        '`of parent` is only valid in pipeline provider aggregate stages.',
        block.line,
        block.column,
        rangeInSourceBlock(bodyBlock, ofIndex, 'of'.length),
      ),
    );
  }
  const aliasIndex = findTopLevelAs(body);
  const sourceBlock = trimSourceBlock(
    sourceBlockSlice(bodyBlock, 0, aliasIndex < 0 ? body.length : aliasIndex),
  );
  const sourceText = sourceBlock.text;
  const providerRowAliasBlock = aliasIndex < 0
    ? undefined
    : trimSourceBlock(sourceBlockSlice(bodyBlock, aliasIndex + 4));
  const providerRowAlias = providerRowAliasBlock?.text;
  const sourceAliasRef = /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(sourceText)
    ? nameRefInSourceBlock(sourceText, sourceBlock)
    : undefined;
  const providerRowAliasRef = providerRowAlias
    ? nameRefInSourceBlock(providerRowAlias, providerRowAliasBlock!)
    : undefined;
  if (!sourceText) {
    diagnostics.push(
      parserError('FDQL_PARSE_ERROR', '`fs.aggregate` needs a source.', block.line, block.column),
    );
    return null;
  }
  if (providerRowAlias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(providerRowAlias)) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        `Invalid aggregate row alias ${providerRowAlias}.`,
        block.line,
        block.column,
        providerRowAliasRef?.range,
      ),
    );
    return null;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(sourceText)) {
    return {
      provider,
      providerRef,
      ...(providerRowAlias ? { providerRowAlias } : {}),
      ...(providerRowAliasRef ? { providerRowAliasRef } : {}),
      sourceAlias: sourceText,
      ...(sourceAliasRef ? { sourceAliasRef } : {}),
    };
  }
  const parsed = parseExpressionBlock(sourceBlock);
  diagnostics.push(...parsed.diagnostics);
  return {
    provider,
    providerRef,
    ...(providerRowAlias ? { providerRowAlias } : {}),
    ...(providerRowAliasRef ? { providerRowAliasRef } : {}),
    sourceAlias: sourceText,
    ...(parsed.expression ? { sourceExpression: parsed.expression } : {}),
  };
}

export function parseProviderAggregateStage(
  lines: readonly SourceLine[],
  startIndex: number,
  diagnostics: FdqlDiagnostic[],
): { readonly nextIndex: number; readonly stage?: FdqlProviderAggregateStage | undefined; } {
  const start = lines[startIndex]!;
  const headerBlock = collectStatementBlock(lines, startIndex);
  const header = parseProviderAggregateHeader(headerBlock, diagnostics);
  const clauses: FdqlLookupClause[] = [];
  let yieldItems: readonly FdqlProviderAggregateYieldItem[] | undefined;
  let nextIndex = headerBlock.nextIndex;
  let endRange = headerBlock.range;

  for (let index = headerBlock.nextIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.text) {
      nextIndex = index;
      endRange = line.range;
      continue;
    }
    if (isProviderClauseBlockStart(lines, index)) {
      const clauseBlock = collectStatementBlock(lines, index);
      const clause = parseProviderClause(clauseBlock, diagnostics);
      if (
        clause?.kind === 'providerWhere' || clause?.kind === 'providerOrderBy'
        || clause?.kind === 'providerLimit'
      ) {
        clauses.push(clause);
      }
      index = clauseBlock.nextIndex;
      nextIndex = clauseBlock.nextIndex;
      endRange = clauseBlock.range;
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
      yieldItems = parseProviderAggregateYieldItems(
        block.source,
        block.sourceLine,
        block.sourceColumn,
        diagnostics,
        block.sourceLocations,
      );
      index = block.nextIndex;
      nextIndex = block.nextIndex;
      endRange = block.range;
      continue;
    }
    break;
  }

  return {
    nextIndex,
    ...(header
      ? {
        stage: {
          ...(header.cache ? { cache: header.cache } : {}),
          ...(header.cacheTtlRaw ? { cacheTtlRaw: header.cacheTtlRaw } : {}),
          clauses,
          column: start.column,
          kind: 'providerAggregate',
          line: start.line,
          ...(header.parent ? { parent: header.parent } : {}),
          provider: header.provider,
          ...(header.providerRef ? { providerRef: header.providerRef } : {}),
          ...(header.providerRowAlias ? { providerRowAlias: header.providerRowAlias } : {}),
          ...(header.providerRowAliasRef
            ? { providerRowAliasRef: header.providerRowAliasRef }
            : {}),
          range: span(start.range, endRange),
          sourceAlias: header.sourceAlias,
          ...(header.sourceAliasRef ? { sourceAliasRef: header.sourceAliasRef } : {}),
          ...(header.sourceExpression ? { sourceExpression: header.sourceExpression } : {}),
          ...(yieldItems ? { yieldItems } : {}),
        },
      }
      : {}),
  };
}

function parseProviderAggregateHeader(
  block: SourceBlock,
  diagnostics: FdqlDiagnostic[],
):
  | {
    readonly cache?: 'off' | 'persistent' | 'run' | undefined;
    readonly cacheTtlRaw?: string | undefined;
    readonly parent?: FdqlExpression | undefined;
    readonly provider: string;
    readonly providerRef?: FdqlNameRef | undefined;
    readonly providerRowAlias?: string | undefined;
    readonly providerRowAliasRef?: FdqlNameRef | undefined;
    readonly sourceAlias: string;
    readonly sourceAliasRef?: FdqlNameRef | undefined;
    readonly sourceExpression?: FdqlExpression | undefined;
  }
  | null
{
  const match = /^then\s+([A-Za-z_][A-Za-z0-9_]*)\.aggregate\b/i.exec(block.text);
  if (!match) return null;
  const provider = match[1]!;
  const providerRef = nameRefInSourceBlock(provider, block, 'then '.length);
  const rawBodyBlock = expressionBlockSlice(block, match[0].length);
  const cache = splitTrailingCache(rawBodyBlock.text);
  const bodyBlock = cache.cacheIndex === undefined
    ? rawBodyBlock
    : trimSourceBlock(sourceBlockSlice(rawBodyBlock, 0, cache.cacheIndex));
  const body = bodyBlock.text;
  const aliasIndex = findTopLevelAs(body);
  const providerRowAliasBlock = aliasIndex < 0
    ? undefined
    : trimSourceBlock(sourceBlockSlice(bodyBlock, aliasIndex + 4));
  const providerRowAlias = providerRowAliasBlock?.text;
  const providerRowAliasRef = providerRowAlias
    ? nameRefInSourceBlock(providerRowAlias, providerRowAliasBlock!)
    : undefined;
  if (providerRowAlias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(providerRowAlias)) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        `Invalid aggregate row alias ${providerRowAlias}.`,
        block.line,
        block.column,
        providerRowAliasRef?.range,
      ),
    );
  }
  const beforeAliasBlock = trimSourceBlock(
    sourceBlockSlice(bodyBlock, 0, aliasIndex < 0 ? body.length : aliasIndex),
  );
  const beforeAlias = beforeAliasBlock.text;
  const ofIndex = findTopLevelKeyword(beforeAlias, 'of');
  const sourceBlock = trimSourceBlock(
    sourceBlockSlice(beforeAliasBlock, 0, ofIndex < 0 ? beforeAlias.length : ofIndex),
  );
  const parentBlock = ofIndex < 0
    ? undefined
    : trimSourceBlock(sourceBlockSlice(beforeAliasBlock, ofIndex + 'of'.length));
  let parent: FdqlExpression | undefined;
  if (parentBlock?.text) {
    const parsed = parseExpressionBlock(parentBlock);
    diagnostics.push(...parsed.diagnostics);
    parent = parsed.expression;
  }
  const parsedSource = parseProviderAggregateSource(sourceBlock, block, diagnostics);
  if (!parsedSource) return null;
  return {
    ...(cache.cache ? { cache: cache.cache } : {}),
    ...(cache.cacheTtlRaw ? { cacheTtlRaw: cache.cacheTtlRaw } : {}),
    ...(parent ? { parent } : {}),
    provider,
    providerRef,
    ...(providerRowAlias ? { providerRowAlias } : {}),
    ...(providerRowAliasRef ? { providerRowAliasRef } : {}),
    ...parsedSource,
  };
}

function parseProviderAggregateSource(
  sourceBlock: SourceBlock,
  headerBlock: SourceBlock,
  diagnostics: FdqlDiagnostic[],
):
  | {
    readonly sourceAlias: string;
    readonly sourceAliasRef?: FdqlNameRef | undefined;
    readonly sourceExpression?: FdqlExpression | undefined;
  }
  | null
{
  const sourceText = sourceBlock.text;
  if (!sourceText) {
    diagnostics.push(
      parserError(
        'FDQL_PARSE_ERROR',
        'Provider aggregate needs a source.',
        headerBlock.line,
        headerBlock.column,
      ),
    );
    return null;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(sourceText)) {
    return {
      sourceAlias: sourceText,
      sourceAliasRef: nameRefInSourceBlock(sourceText, sourceBlock),
    };
  }
  const parsed = parseExpressionBlock(sourceBlock);
  diagnostics.push(...parsed.diagnostics);
  return {
    sourceAlias: sourceText,
    ...(parsed.expression ? { sourceExpression: parsed.expression } : {}),
  };
}

function splitTrailingCache(
  body: string,
): {
  readonly body: string;
  readonly cache?: 'off' | 'persistent' | 'run' | undefined;
  readonly cacheIndex?: number | undefined;
  readonly cacheTtlRaw?: string | undefined;
} {
  const cacheIndex = findTopLevelKeyword(body, 'cache');
  if (cacheIndex < 0) return { body };
  const sourceBody = body.slice(0, cacheIndex).trim();
  const cacheBody = body.slice(cacheIndex + 'cache'.length).trim();
  const match = /^(off|run|persistent)(?:\s+(\d+[smhd]))?$/i.exec(cacheBody);
  return {
    body: sourceBody,
    ...(match?.[1] ? { cache: match[1].toLowerCase() as 'off' | 'persistent' | 'run' } : {}),
    cacheIndex,
    ...(match?.[2] ? { cacheTtlRaw: match[2] } : {}),
  };
}

function findTopLevelKeyword(source: string, keyword: string): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === quote && source[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (
      depth === 0
      && source.slice(index, index + keyword.length).toLowerCase() === keyword
      && (index === 0 || /\s/.test(source[index - 1] ?? ''))
      && (index + keyword.length === source.length
        || /\s/.test(source[index + keyword.length] ?? ''))
    ) {
      return index;
    }
  }
  return -1;
}
