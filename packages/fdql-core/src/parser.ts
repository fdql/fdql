import { findTopLevelAs, parseExpression, splitTopLevel } from './expression.ts';
import type {
  FdqlAggregateStage,
  FdqlAliasDeclaration,
  FdqlAst,
  FdqlDiagnostic,
  FdqlFromStage,
  FdqlLookupClause,
  FdqlParseResult,
  FdqlProgram,
  FdqlProjectionItem,
  FdqlReturnStage,
  FdqlSetDeclaration,
  FdqlSourceRange,
  FdqlStage,
  FdqlUnionProgram,
  FdqlWithStage,
} from './types.ts';

interface SourceLine {
  readonly column: number;
  readonly line: number;
  readonly range: FdqlSourceRange;
  readonly text: string;
}

export function parseFdql(source: string): FdqlParseResult {
  const unionParts = splitUnionAll(source);
  if (unionParts.length > 1) {
    const preamble = sharedPreamble(unionParts[0]!);
    const branches = unionParts.map((part, index) =>
      index === 0 ? part : `${preamble}${preamble ? '\n' : ''}${part}`
    );
    const parsedBranches = branches.map(parseFdqlPipeline);
    const diagnostics = parsedBranches.flatMap((branch) => branch.diagnostics);
    const programs: FdqlProgram[] = parsedBranches.flatMap((branch) =>
      branch.ast && !isUnionAst(branch.ast) ? [branch.ast] : []
    );
    const ast: FdqlUnionProgram = { branches: programs, kind: 'union' };
    return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? { ast, diagnostics, ok: false }
      : { ast, diagnostics, ok: true };
  }
  return parseFdqlPipeline(source);
}

function parseFdqlPipeline(source: string): FdqlParseResult {
  const diagnostics: FdqlDiagnostic[] = [];
  const aliases: FdqlAliasDeclaration[] = [];
  const settings: FdqlSetDeclaration[] = [];
  const stages: FdqlStage[] = [];
  let from: FdqlFromStage | undefined;
  let seenAlias = false;
  let seenPipeline = false;
  const lines = createSourceLines(source);

  for (let index = 0; index < lines.length; index += 1) {
    const { column, line, range, text } = lines[index]!;
    if (!text) continue;
    if (text.startsWith('set ')) {
      if (seenPipeline) {
        diagnostics.push(
          error('FDQL_INVALID_SET', '`set` must appear before the pipeline.', line, column),
        );
        continue;
      }
      if (seenAlias) {
        diagnostics.push(
          error('FDQL_INVALID_SET', '`set` must appear before `alias`.', line, column),
        );
        continue;
      }
      const declaration = parseSet(text, line, column, range, diagnostics);
      if (declaration) settings.push(declaration);
      continue;
    }
    if (text.startsWith('alias ')) {
      if (seenPipeline) {
        diagnostics.push(
          error(
            'FDQL_INVALID_ALIAS_NAME',
            '`alias` must appear before the pipeline.',
            line,
            column,
          ),
        );
        continue;
      }
      const alias = parseAlias(text, line, column, range, diagnostics);
      if (alias) aliases.push(alias);
      seenAlias = true;
      continue;
    }
    seenPipeline = true;
    if (text.startsWith('from ')) {
      if (from) {
        diagnostics.push(
          error('FDQL_MULTIPLE_FROM', 'A pipeline can only have one `from`.', line, column),
        );
        continue;
      }
      from = parseFrom(text, line, column, range, diagnostics);
      continue;
    }
    const providerClause = parseProviderClause({ column, line, range, text }, diagnostics);
    if (providerClause) {
      stages.push(providerClause);
      continue;
    }
    if (text.startsWith('then filter ')) {
      const expressionSource = expressionSlice(text, column, 'then filter '.length);
      const parsed = parseExpression(expressionSource.text, line, expressionSource.column);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.expression) {
        stages.push({ column, expression: parsed.expression, kind: 'filter', line, range });
      }
      continue;
    }
    if (text.startsWith('then take ')) {
      stages.push({
        column,
        kind: 'take',
        line,
        range,
        value: Number(text.slice('then take '.length).trim()),
      });
      continue;
    }
    if (text.startsWith('then sort by ')) {
      const parsed = parseSortBy(text, line, column, range, diagnostics);
      if (parsed) stages.push(parsed);
      continue;
    }
    if (text === 'then aggregate' || text.startsWith('then aggregate ')) {
      const block = collectProjection(lines, index, 'then aggregate');
      index = block.nextIndex;
      const aggregate = parseAggregate(
        block.source,
        block.sourceLine,
        block.sourceColumn,
        column,
        line,
        block.range,
        diagnostics,
      );
      stages.push(aggregate);
      continue;
    }
    if (text.startsWith('then lookup ')) {
      const lookup = parseLookup(lines, index, diagnostics);
      index = lookup.nextIndex;
      if (lookup.stage) stages.push(lookup.stage);
      continue;
    }
    if (text.startsWith('then unwind ')) {
      const unwind = parseUnwind(text, line, column, range, diagnostics);
      if (unwind) stages.push(unwind);
      continue;
    }
    if (text === 'then with' || text.startsWith('then with ')) {
      const block = collectProjection(lines, index, 'then with');
      index = block.nextIndex;
      const parsed = parseProjectionItems(
        block.source,
        block.sourceLine,
        block.sourceColumn,
        diagnostics,
      );
      stages.push(
        { column, items: parsed, kind: 'with', line, range: block.range } satisfies FdqlWithStage,
      );
      continue;
    }
    if (text === 'return' || text.startsWith('return ')) {
      const block = collectProjection(lines, index, 'return');
      index = block.nextIndex;
      const parsed = parseProjectionItems(
        block.source,
        block.sourceLine,
        block.sourceColumn,
        diagnostics,
      );
      stages.push(
        {
          column,
          items: parsed,
          kind: 'return',
          line,
          range: block.range,
        } satisfies FdqlReturnStage,
      );
      continue;
    }
    stages.push({ column, kind: 'unsupported', line, range, text });
  }

  const ast: FdqlProgram = {
    aliases,
    ...(from ? { from } : {}),
    settings,
    stages,
  };
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { ast, diagnostics, ok: false }
    : { ast, diagnostics, ok: true };
}

function parseLookup(
  lines: readonly SourceLine[],
  startIndex: number,
  diagnostics: FdqlDiagnostic[],
): { readonly nextIndex: number; readonly stage?: FdqlStage | undefined; } {
  const start = lines[startIndex]!;
  const match =
    /^then\s+lookup\s+(one|many)\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+cache\s+(off|run|session))?$/i
      .exec(start.text);
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
    if (!isProviderClauseStart(line.text)) break;
    const clause = parseLookupClause(line, diagnostics);
    if (clause) clauses.push(clause);
    nextIndex = index;
    endRange = line.range;
  }

  if (!match) {
    if (isMalformedLookupCache(start.text)) {
      diagnostics.push(
        error(
          'FDQL_INVALID_LOOKUP_CACHE',
          '`lookup` cache must use `cache run`, `cache off`, or `cache session`.',
          start.line,
          start.column,
        ),
      );
      return { nextIndex };
    }
    diagnostics.push(
      error(
        'FDQL_UNKNOWN_STAGE',
        '`lookup` must use `then lookup one|many $source as rowAlias`.',
        start.line,
        start.column,
      ),
    );
    return { nextIndex };
  }

  return {
    nextIndex,
    stage: {
      ...(match[4] ? { cache: match[4].toLowerCase() as 'off' | 'run' | 'session' } : {}),
      clauses,
      column: start.column,
      kind: 'lookup',
      line: start.line,
      mode: match[1]!.toLowerCase() as 'many' | 'one',
      range: span(start.range, endRange),
      rowAlias: match[3]!,
      sourceAlias: match[2]!,
    },
  };
}

function isMalformedLookupCache(text: string): boolean {
  return /^then\s+lookup\s+(one|many)\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+cache(?:\s|=|$)/i
    .test(text);
}

function parseLookupClause(
  line: SourceLine,
  diagnostics: FdqlDiagnostic[],
): FdqlLookupClause | null {
  const { column, range, text } = line;
  const provider = providerFromStatement(text);
  if (!provider) {
    diagnostics.push(
      error('FDQL_UNKNOWN_STAGE', `Unsupported lookup clause: ${text}.`, line.line, column),
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
    error('FDQL_UNKNOWN_STAGE', `Unsupported lookup clause: ${text}.`, line.line, column),
  );
  return null;
}

function parseSortBy(
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

function parseProviderClause(line: SourceLine, diagnostics: FdqlDiagnostic[]): FdqlStage | null {
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

function parseAggregate(
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
        error('FDQL_PARSE_ERROR', 'Aggregate `by` expressions need `as`.', line, column),
      );
    }
  }
  for (const item of items) {
    if (!item.alias) {
      diagnostics.push(error('FDQL_PARSE_ERROR', 'Aggregate expressions need `as`.', line, column));
    }
  }
  return { column, groups, items, kind: 'aggregate', line, range };
}

function isAggregateProjection(source: string): boolean {
  return /^(count|sum|avg|min|max)\s*\(/i.test(source.trim());
}

function parseUnwind(
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
      error(
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
      error('FDQL_PARSE_ERROR', `Invalid unwind row alias ${rowAlias}.`, line, column),
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

function parseSet(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlSetDeclaration | null {
  const separator = text.indexOf('=');
  if (separator < 0) {
    diagnostics.push(
      error('FDQL_INVALID_SET', '`set` must use `set key = value`.', line, column),
    );
    return null;
  }
  const key = text.slice('set '.length, separator).trim();
  const valueSource = expressionSlice(text, column, separator + 1);
  if (key === 'fdql.timeout' && looksLikeDurationLiteral(valueSource.text)) {
    return { column, key, line, range, rawValue: valueSource.text };
  }
  const parsed = parseExpression(valueSource.text, line, valueSource.column);
  diagnostics.push(...parsed.diagnostics);
  return {
    column,
    key,
    line,
    range,
    rawValue: valueSource.text,
    ...(parsed.expression ? { value: parsed.expression } : {}),
  };
}

function looksLikeDurationLiteral(value: string): boolean {
  return /^\d+[smhd]$/i.test(value.trim());
}

function parseAlias(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlAliasDeclaration | null {
  const separator = text.indexOf('=');
  if (separator < 0) {
    diagnostics.push(
      error('FDQL_INVALID_ALIAS_NAME', '`alias` must use `alias $name = value`.', line, column),
    );
    return null;
  }
  const name = text.slice('alias '.length, separator).trim();
  const valueSource = expressionSlice(text, column, separator + 1);
  const parsed = parseExpression(valueSource.text, line, valueSource.column);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression ? { column, line, name, range, value: parsed.expression } : null;
}

function parseFrom(
  text: string,
  line: number,
  column: number,
  range: FdqlSourceRange,
  diagnostics: FdqlDiagnostic[],
): FdqlFromStage | undefined {
  const match = /^from\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(text);
  if (!match) {
    diagnostics.push(
      error('FDQL_PARSE_ERROR', '`from` must use `from $source as rowAlias`.', line, column),
    );
    return undefined;
  }
  return { column, kind: 'from', line, range, rowAlias: match[2]!, sourceAlias: match[1]! };
}

function collectProjection(
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

function parseProjectionItems(
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

function createSourceLines(source: string): readonly SourceLine[] {
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

function splitUnionAll(source: string): readonly string[] {
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

function sharedPreamble(source: string): string {
  const lines = source.split(/\r?\n/);
  const preamble: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      preamble.push(line);
      continue;
    }
    if (trimmed.startsWith('from ')) break;
    preamble.push(line);
  }
  return preamble.join('\n').trim();
}

function firstNonWhitespaceIndex(text: string): number {
  const index = text.search(/\S/);
  return index < 0 ? 0 : index;
}

function expressionSlice(
  text: string,
  statementColumn: number,
  startIndex: number,
): { readonly column: number; readonly text: string; } {
  const raw = text.slice(startIndex);
  const leading = firstNonWhitespaceIndex(raw);
  return { column: statementColumn + startIndex + leading, text: raw.trim() };
}

function span(start: FdqlSourceRange, end: FdqlSourceRange): FdqlSourceRange {
  return {
    endColumn: end.endColumn,
    endLine: end.endLine,
    startColumn: start.startColumn,
    startLine: start.startLine,
  };
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

function providerFromStatement(text: string): string | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+(where|order by|limit)\b/i.exec(text);
  return match?.[1] ?? null;
}

function isProviderClauseStart(text: string): boolean {
  return Boolean(providerFromStatement(text));
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isStatementStart(text: string): boolean {
  return /^(set|alias|from|then |return|union all)\b/.test(text) || isProviderClauseStart(text);
}

function isUnionAst(ast: FdqlAst): ast is FdqlUnionProgram {
  return 'kind' in ast && ast.kind === 'union';
}

function error(code: string, message: string, line: number, column: number): FdqlDiagnostic {
  return { code, column, line, message, severity: 'error' };
}
