import { findTopLevelAs, parseExpression, splitTopLevel } from './expression.ts';
import type {
  FdqlAliasDeclaration,
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
  FdqlWithStage,
} from './types.ts';

interface SourceLine {
  readonly column: number;
  readonly line: number;
  readonly range: FdqlSourceRange;
  readonly text: string;
}

export function parseFdql(source: string): FdqlParseResult {
  const diagnostics: FdqlDiagnostic[] = [];
  const aliases: FdqlAliasDeclaration[] = [];
  const settings: FdqlSetDeclaration[] = [];
  const stages: FdqlStage[] = [];
  let from: FdqlFromStage | undefined;
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
    if (text.startsWith('fs where ')) {
      const expressionSource = expressionSlice(text, column, 'fs where '.length);
      const parsed = parseExpression(expressionSource.text, line, expressionSource.column);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.expression) {
        stages.push({ column, expression: parsed.expression, kind: 'fsWhere', line, range });
      }
      continue;
    }
    if (text.startsWith('fs order by ')) {
      const sourceBody = expressionSlice(text, column, 'fs order by '.length);
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
      if (parsed.expression) {
        stages.push({
          column,
          direction,
          expression: parsed.expression,
          kind: 'fsOrderBy',
          line,
          range,
        });
      }
      continue;
    }
    if (text.startsWith('fs limit ')) {
      stages.push({
        column,
        kind: 'fsLimit',
        line,
        range,
        value: Number(text.slice('fs limit '.length).trim()),
      });
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
    if (text.startsWith('then lookup ')) {
      const lookup = parseLookup(lines, index, diagnostics);
      index = lookup.nextIndex;
      if (lookup.stage) stages.push(lookup.stage);
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
    /^then\s+lookup\s+(one|many)\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i
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
    if (!line.text.startsWith('fs ')) break;
    const clause = parseLookupClause(line, diagnostics);
    if (clause) clauses.push(clause);
    nextIndex = index;
    endRange = line.range;
  }

  if (!match) {
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

function parseLookupClause(
  line: SourceLine,
  diagnostics: FdqlDiagnostic[],
): FdqlLookupClause | null {
  const { column, range, text } = line;
  if (text.startsWith('fs where ')) {
    const expressionSource = expressionSlice(text, column, 'fs where '.length);
    const parsed = parseExpression(expressionSource.text, line.line, expressionSource.column);
    diagnostics.push(...parsed.diagnostics);
    return parsed.expression
      ? { column, expression: parsed.expression, kind: 'fsWhere', line: line.line, range }
      : null;
  }
  if (text.startsWith('fs order by ')) {
    const sourceBody = expressionSlice(text, column, 'fs order by '.length);
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
        kind: 'fsOrderBy',
        line: line.line,
        range,
      }
      : null;
  }
  if (text.startsWith('fs limit ')) {
    return {
      column,
      kind: 'fsLimit',
      line: line.line,
      range,
      value: Number(text.slice('fs limit '.length).trim()),
    };
  }
  diagnostics.push(
    error('FDQL_UNKNOWN_STAGE', `Unsupported lookup clause: ${text}.`, line.line, column),
  );
  return null;
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
  const parsed = parseExpression(valueSource.text, line, valueSource.column);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression ? { column, key, line, range, value: parsed.expression } : null;
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

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isStatementStart(text: string): boolean {
  return /^(set|alias|from|fs |then |return|union all)\b/.test(text);
}

function error(code: string, message: string, line: number, column: number): FdqlDiagnostic {
  return { code, column, line, message, severity: 'error' };
}
