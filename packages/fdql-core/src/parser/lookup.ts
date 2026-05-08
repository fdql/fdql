import { findTopLevelAs, parseExpression } from '../expression.ts';
import type { FdqlDiagnostic, FdqlExpression, FdqlLookupClause, FdqlStage } from '../types.ts';
import { isProviderClauseStart, parserError, providerFromStatement } from './helpers.ts';
import { expressionSlice, type SourceLine, span } from './source-text.ts';

interface LookupHeader {
  readonly cache?: 'off' | 'persistent' | 'run' | undefined;
  readonly cacheTtlRaw?: string | undefined;
  readonly mode: 'many' | 'one';
  readonly required: boolean;
  readonly rowAlias: string;
  readonly sourceColumn: number;
  readonly sourceText: string;
}

export function parseLookup(
  lines: readonly SourceLine[],
  startIndex: number,
  diagnostics: FdqlDiagnostic[],
): { readonly nextIndex: number; readonly stage?: FdqlStage | undefined; } {
  const start = lines[startIndex]!;
  const clauses: FdqlLookupClause[] = [];
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
      const clause = parseLookupClause(line, diagnostics);
      if (clause) clauses.push(clause);
      nextIndex = index;
      endRange = line.range;
      continue;
    }
    break;
  }

  const header = parseLookupHeader(start);
  if (!header) {
    if (isMalformedLookupCache(start.text)) {
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

  const parsedSource = parseLookupSource(
    header.sourceText,
    start.line,
    header.sourceColumn,
    diagnostics,
  );
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
      sourceAlias: parsedSource.sourceAlias,
      ...(parsedSource.sourceExpression ? { sourceExpression: parsedSource.sourceExpression } : {}),
    },
  };
}

function parseLookupHeader(line: SourceLine): LookupHeader | null {
  const prefix = 'then lookup ';
  let body = line.text.slice(prefix.length).trim();
  let bodyColumn = line.column + prefix.length;
  const required = body.toLowerCase().startsWith('required ');
  if (required) {
    body = body.slice('required '.length).trimStart();
    bodyColumn = line.column + line.text.indexOf(body);
  }
  const modeMatch = /^(one|many)\s+/i.exec(body);
  if (!modeMatch || (required && modeMatch[1]?.toLowerCase() !== 'one')) return null;
  const mode = modeMatch[1]!.toLowerCase() as 'many' | 'one';
  const remainder = body.slice(modeMatch[0].length);
  const remainderColumn = bodyColumn + modeMatch[0].length;
  const aliasIndex = findTopLevelAs(remainder);
  if (aliasIndex < 0) return null;
  const sourceText = remainder.slice(0, aliasIndex).trim();
  if (!sourceText) return null;
  const sourceColumn = remainderColumn + remainder.indexOf(sourceText);
  const suffix = remainder.slice(aliasIndex + 4).trim();
  const suffixMatch =
    /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+cache\s+(off|run|persistent)(?:\s+(\d+[smhd]))?)?$/i
      .exec(suffix);
  if (!suffixMatch) return null;
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
    rowAlias: suffixMatch[1]!,
    sourceColumn,
    sourceText,
  };
}

function isMalformedLookupCache(text: string): boolean {
  return /^then\s+lookup\s+(?:required\s+one|one|many)\s+.+?\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+cache(?:\s|=|$)/i
    .test(text);
}

function parseLookupSource(
  text: string,
  line: number,
  column: number,
  diagnostics: FdqlDiagnostic[],
): {
  readonly parent?: FdqlExpression | undefined;
  readonly sourceAlias: string;
  readonly sourceExpression?: FdqlExpression | undefined;
} {
  const ofIndex = findTopLevelKeyword(text, 'of');
  const sourceText = (ofIndex >= 0 ? text.slice(0, ofIndex) : text).trim();
  const parentText = ofIndex >= 0 ? text.slice(ofIndex + 'of'.length).trim() : '';
  let parent: FdqlExpression | undefined;
  if (parentText) {
    const parentOffset = text.indexOf(parentText, ofIndex + 'of'.length);
    const parsedParent = parseExpression(parentText, line, column + parentOffset);
    diagnostics.push(...parsedParent.diagnostics);
    parent = parsedParent.expression;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(sourceText)) {
    return {
      ...(parent ? { parent } : {}),
      sourceAlias: sourceText,
    };
  }
  const parsedSource = parseExpression(sourceText, line, column);
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

function parseLookupClause(
  line: SourceLine,
  diagnostics: FdqlDiagnostic[],
): FdqlLookupClause | null {
  const { column, range, text } = line;
  const provider = providerFromStatement(text);
  if (!provider) {
    diagnostics.push(
      parserError('FDQL_UNKNOWN_STAGE', `Unsupported lookup clause: ${text}.`, line.line, column),
    );
    return null;
  }
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
  diagnostics.push(
    parserError('FDQL_UNKNOWN_STAGE', `Unsupported lookup clause: ${text}.`, line.line, column),
  );
  return null;
}
