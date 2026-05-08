import { parseExpression } from './expression.ts';
import { isUnionAst, parserError } from './parser/helpers.ts';
import { parseLookup } from './parser/lookup.ts';
import { parseAlias, parseSet } from './parser/preamble.ts';
import { collectProjection, parseProjectionItems } from './parser/projection.ts';
import {
  createSourceLines,
  expressionSlice,
  sharedPreamble,
  splitUnionAll,
} from './parser/source-text.ts';
import {
  parseAggregateFrom,
  parseAggregateStage,
  parseFrom,
  parseProviderClause,
  parseSortBy,
  parseUnwind,
} from './parser/stages.ts';
import type {
  FdqlAliasDeclaration,
  FdqlDiagnostic,
  FdqlFromStage,
  FdqlParseResult,
  FdqlProgram,
  FdqlReturnStage,
  FdqlSetDeclaration,
  FdqlStage,
  FdqlUnionProgram,
  FdqlWithStage,
} from './types.ts';

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
          parserError('FDQL_INVALID_SET', '`set` must appear before the pipeline.', line, column),
        );
        continue;
      }
      if (seenAlias) {
        diagnostics.push(
          parserError('FDQL_INVALID_SET', '`set` must appear before `alias`.', line, column),
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
          parserError(
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
          parserError('FDQL_MULTIPLE_FROM', 'A pipeline can only have one `from`.', line, column),
        );
        continue;
      }
      const aggregateFrom = parseAggregateFrom(lines, index, diagnostics);
      if (aggregateFrom) {
        from = aggregateFrom.from;
        index = aggregateFrom.nextIndex;
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
      const aggregate = parseAggregateStage(lines, index, diagnostics);
      index = aggregate.nextIndex;
      stages.push(aggregate.stage);
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
