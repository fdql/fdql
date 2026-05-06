import { findTopLevelAs, parseExpression, splitTopLevel } from './expression.ts';
import type {
  FdqlAliasDeclaration,
  FdqlDiagnostic,
  FdqlFromStage,
  FdqlParseResult,
  FdqlProgram,
  FdqlProjectionItem,
  FdqlReturnStage,
  FdqlSetDeclaration,
  FdqlStage,
  FdqlWithStage,
} from './types.ts';

export function parseFdql(source: string): FdqlParseResult {
  const diagnostics: FdqlDiagnostic[] = [];
  const aliases: FdqlAliasDeclaration[] = [];
  const settings: FdqlSetDeclaration[] = [];
  const stages: FdqlStage[] = [];
  let from: FdqlFromStage | undefined;
  let seenPipeline = false;
  const lines = source.split(/\r?\n/).map((text, index) => ({
    line: index + 1,
    text: stripComment(text).trim(),
  }));

  for (let index = 0; index < lines.length; index += 1) {
    const { line, text } = lines[index]!;
    if (!text) continue;
    if (text.startsWith('set ')) {
      if (seenPipeline) {
        diagnostics.push(error('FDQL_INVALID_SET', '`set` must appear before the pipeline.', line));
        continue;
      }
      const declaration = parseSet(text, line, diagnostics);
      if (declaration) settings.push(declaration);
      continue;
    }
    if (text.startsWith('alias ')) {
      if (seenPipeline) {
        diagnostics.push(
          error('FDQL_INVALID_ALIAS_NAME', '`alias` must appear before the pipeline.', line),
        );
        continue;
      }
      const alias = parseAlias(text, line, diagnostics);
      if (alias) aliases.push(alias);
      continue;
    }
    seenPipeline = true;
    if (text.startsWith('from ')) {
      if (from) {
        diagnostics.push(error('FDQL_MULTIPLE_FROM', 'A pipeline can only have one `from`.', line));
        continue;
      }
      from = parseFrom(text, line, diagnostics);
      continue;
    }
    if (text.startsWith('fs where ')) {
      const parsed = parseExpression(text.slice('fs where '.length), line);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.expression) stages.push({ expression: parsed.expression, kind: 'fsWhere', line });
      continue;
    }
    if (text.startsWith('fs order by ')) {
      const body = text.slice('fs order by '.length).trim();
      const direction = body.toLowerCase().endsWith(' desc')
        ? 'desc'
        : body.toLowerCase().endsWith(' asc')
        ? 'asc'
        : 'asc';
      const expressionText = direction === 'asc' && !body.toLowerCase().endsWith(' asc')
        ? body
        : body.slice(0, Math.max(0, body.length - 4)).trim();
      const parsed = parseExpression(expressionText, line);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.expression) {
        stages.push({ direction, expression: parsed.expression, kind: 'fsOrderBy', line });
      }
      continue;
    }
    if (text.startsWith('fs limit ')) {
      stages.push({ kind: 'fsLimit', line, value: Number(text.slice('fs limit '.length).trim()) });
      continue;
    }
    if (text.startsWith('then filter ')) {
      const parsed = parseExpression(text.slice('then filter '.length), line);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.expression) stages.push({ expression: parsed.expression, kind: 'filter', line });
      continue;
    }
    if (text.startsWith('then take ')) {
      stages.push({ kind: 'take', line, value: Number(text.slice('then take '.length).trim()) });
      continue;
    }
    if (text === 'then with' || text.startsWith('then with ')) {
      const block = collectProjection(lines, index, 'then with');
      index = block.nextIndex;
      const parsed = parseProjectionItems(block.source, line, diagnostics);
      stages.push({ items: parsed, kind: 'with', line } satisfies FdqlWithStage);
      continue;
    }
    if (text === 'return' || text.startsWith('return ')) {
      const block = collectProjection(lines, index, 'return');
      index = block.nextIndex;
      const parsed = parseProjectionItems(block.source, line, diagnostics);
      stages.push({ items: parsed, kind: 'return', line } satisfies FdqlReturnStage);
      continue;
    }
    stages.push({ kind: 'unsupported', line, text });
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

function parseSet(
  text: string,
  line: number,
  diagnostics: FdqlDiagnostic[],
): FdqlSetDeclaration | null {
  const separator = text.indexOf('=');
  if (separator < 0) {
    diagnostics.push(error('FDQL_INVALID_SET', '`set` must use `set key = value`.', line));
    return null;
  }
  const key = text.slice('set '.length, separator).trim();
  const parsed = parseExpression(text.slice(separator + 1).trim(), line);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression ? { key, line, value: parsed.expression } : null;
}

function parseAlias(
  text: string,
  line: number,
  diagnostics: FdqlDiagnostic[],
): FdqlAliasDeclaration | null {
  const separator = text.indexOf('=');
  if (separator < 0) {
    diagnostics.push(
      error('FDQL_INVALID_ALIAS_NAME', '`alias` must use `alias $name = value`.', line),
    );
    return null;
  }
  const name = text.slice('alias '.length, separator).trim();
  const parsed = parseExpression(text.slice(separator + 1).trim(), line);
  diagnostics.push(...parsed.diagnostics);
  return parsed.expression ? { line, name, value: parsed.expression } : null;
}

function parseFrom(
  text: string,
  line: number,
  diagnostics: FdqlDiagnostic[],
): FdqlFromStage | undefined {
  const match = /^from\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(text);
  if (!match) {
    diagnostics.push(
      error('FDQL_PARSE_ERROR', '`from` must use `from $source as rowAlias`.', line),
    );
    return undefined;
  }
  return { kind: 'from', line, rowAlias: match[2]!, sourceAlias: match[1]! };
}

function collectProjection(
  lines: readonly { readonly line: number; readonly text: string; }[],
  startIndex: number,
  keyword: string,
): { readonly nextIndex: number; readonly source: string; } {
  const current = lines[startIndex]!.text;
  const inline = current.slice(keyword.length).trim();
  const parts: string[] = inline ? [inline] : [];
  let nextIndex = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const text = lines[index]!.text;
    if (!text) {
      nextIndex = index;
      continue;
    }
    if (isStatementStart(text)) break;
    parts.push(text);
    nextIndex = index;
  }
  return { nextIndex, source: parts.join('\n') };
}

function parseProjectionItems(
  source: string,
  line: number,
  diagnostics: FdqlDiagnostic[],
): readonly FdqlProjectionItem[] {
  return splitTopLevel(source.replace(/\n/g, ',')).map((item) => {
    const aliasIndex = findTopLevelAs(item);
    const expressionText = aliasIndex < 0 ? item.trim() : item.slice(0, aliasIndex).trim();
    const alias = aliasIndex < 0 ? undefined : item.slice(aliasIndex + 4).trim();
    const parsed = parseExpression(expressionText, line);
    diagnostics.push(...parsed.diagnostics);
    return {
      ...(alias ? { alias } : {}),
      expression: parsed.expression ?? { kind: 'literal', value: null },
      label: item,
    };
  });
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

function error(code: string, message: string, line: number): FdqlDiagnostic {
  return { code, line, message, severity: 'error' };
}
