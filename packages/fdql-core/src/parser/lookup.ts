import { findTopLevelAs } from '../expression.ts';
import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlLookupClause,
  FdqlNameRef,
  FdqlStage,
} from '../types.ts';
import { parserError } from './helpers.ts';
import {
  collectStatementBlock,
  expressionBlockSlice,
  isProviderClauseBlockStart,
  nameRefInSourceBlock,
  parseExpressionBlock,
  type SourceBlock,
  sourceBlockSlice,
  trimSourceBlock,
} from './source-block.ts';
import { type SourceLine, span } from './source-text.ts';
import { parseProviderClause } from './stages.ts';

interface LookupHeader {
  readonly cache?: 'off' | 'persistent' | 'run' | undefined;
  readonly cacheTtlRaw?: string | undefined;
  readonly mode: 'many' | 'one';
  readonly required: boolean;
  readonly rowAlias: string;
  readonly rowAliasRef: FdqlNameRef;
  readonly source: SourceBlock;
}

export function parseLookup(
  lines: readonly SourceLine[],
  startIndex: number,
  diagnostics: FdqlDiagnostic[],
): { readonly nextIndex: number; readonly stage?: FdqlStage | undefined; } {
  const start = lines[startIndex]!;
  const headerBlock = collectStatementBlock(lines, startIndex);
  const clauses: FdqlLookupClause[] = [];
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
    break;
  }

  const header = parseLookupHeader(headerBlock);
  if (!header) {
    if (isMalformedLookupCache(headerBlock.text)) {
      diagnostics.push(
        parserError(
          'FDQL_INVALID_LOOKUP_CACHE',
          '`lookup` cache must use `cache off`, `cache run`, or `cache persistent 60s`.',
          start.line,
          start.column,
        ),
      );
      return { nextIndex };
    }
    diagnostics.push(
      parserError(
        'FDQL_UNKNOWN_STAGE',
        '`lookup` must use `then lookup one|many source as rowAlias` or `then lookup required one source as rowAlias`.',
        start.line,
        start.column,
      ),
    );
    return { nextIndex };
  }

  const parsedSource = parseLookupSource(header.source, diagnostics);
  return {
    nextIndex,
    stage: {
      ...(header.cache ? { cache: header.cache } : {}),
      ...(header.cacheTtlRaw ? { cacheTtlRaw: header.cacheTtlRaw } : {}),
      clauses,
      column: start.column,
      kind: 'lookup',
      line: start.line,
      mode: header.mode,
      ...(parsedSource.parent ? { parent: parsedSource.parent } : {}),
      range: span(start.range, endRange),
      required: header.required,
      rowAlias: header.rowAlias,
      rowAliasRef: header.rowAliasRef,
      sourceAlias: parsedSource.sourceAlias,
      ...(parsedSource.sourceAliasRef ? { sourceAliasRef: parsedSource.sourceAliasRef } : {}),
      ...(parsedSource.sourceExpression ? { sourceExpression: parsedSource.sourceExpression } : {}),
    },
  };
}

function parseLookupHeader(block: SourceBlock): LookupHeader | null {
  const prefix = 'then lookup ';
  let bodyBlock = expressionBlockSlice(block, prefix.length);
  let body = bodyBlock.text;
  const required = body.toLowerCase().startsWith('required ');
  if (required) {
    bodyBlock = expressionBlockSlice(bodyBlock, 'required '.length);
    body = bodyBlock.text;
  }
  const modeMatch = /^(one|many)\s+/i.exec(body);
  if (!modeMatch || (required && modeMatch[1]?.toLowerCase() !== 'one')) return null;
  const mode = modeMatch[1]!.toLowerCase() as 'many' | 'one';
  const remainderBlock = sourceBlockSlice(bodyBlock, modeMatch[0].length);
  const remainder = remainderBlock.text;
  const aliasIndex = findTopLevelAs(remainder);
  if (aliasIndex < 0) return null;
  const source = trimSourceBlock(sourceBlockSlice(remainderBlock, 0, aliasIndex));
  if (!source.text) return null;
  const suffixBlock = trimSourceBlock(sourceBlockSlice(remainderBlock, aliasIndex + 4));
  const suffix = suffixBlock.text;
  const suffixMatch =
    /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+cache\s+(off|run|persistent)(?:\s+(\d+[smhd]))?)?$/i
      .exec(suffix);
  if (!suffixMatch) return null;
  const rowAlias = suffixMatch[1]!;
  return {
    ...(suffixMatch[2]
      ? {
        cache: suffixMatch[2]!.toLowerCase() as
          | 'off'
          | 'persistent'
          | 'run',
      }
      : {}),
    ...(suffixMatch[3] ? { cacheTtlRaw: suffixMatch[3] } : {}),
    mode,
    required,
    rowAlias,
    rowAliasRef: nameRefInSourceBlock(rowAlias, suffixBlock),
    source,
  };
}

function isMalformedLookupCache(text: string): boolean {
  return /^then\s+lookup\s+(?:required\s+one|one|many)\s+.+?\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+cache(?:\s|=|$)/i
    .test(text);
}

function parseLookupSource(
  block: SourceBlock,
  diagnostics: FdqlDiagnostic[],
): {
  readonly parent?: FdqlExpression | undefined;
  readonly sourceAlias: string;
  readonly sourceAliasRef?: FdqlNameRef | undefined;
  readonly sourceExpression?: FdqlExpression | undefined;
} {
  const text = block.text;
  const ofIndex = findTopLevelKeyword(text, 'of');
  const sourceBlock = trimSourceBlock(
    sourceBlockSlice(block, 0, ofIndex >= 0 ? ofIndex : text.length),
  );
  const sourceText = sourceBlock.text;
  const parentBlock = ofIndex >= 0
    ? trimSourceBlock(sourceBlockSlice(block, ofIndex + 'of'.length))
    : undefined;
  let parent: FdqlExpression | undefined;
  if (parentBlock?.text) {
    const parsedParent = parseExpressionBlock(parentBlock);
    diagnostics.push(...parsedParent.diagnostics);
    parent = parsedParent.expression;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(sourceText)) {
    return {
      ...(parent ? { parent } : {}),
      sourceAlias: sourceText,
      sourceAliasRef: nameRefInSourceBlock(sourceText, sourceBlock),
    };
  }
  const parsedSource = parseExpressionBlock(sourceBlock);
  diagnostics.push(...parsedSource.diagnostics);
  return {
    ...(parent ? { parent } : {}),
    sourceAlias: sourceText,
    ...(parsedSource.expression ? { sourceExpression: parsedSource.expression } : {}),
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
