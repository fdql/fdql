import { isUnionAst, parserError } from './parser/helpers.ts';
import { parseLookup } from './parser/lookup.ts';
import { parseAlias, parseSet } from './parser/preamble.ts';
import { collectProjection, parseProjectionItems } from './parser/projection.ts';
import {
  collectStatementBlock,
  expressionBlockSlice,
  parseExpressionBlock,
} from './parser/source-block.ts';
import { createSourceLines, sharedPreamble, splitUnionAll } from './parser/source-text.ts';
import {
  parseAggregateFrom,
  parseAggregateStage,
  parseFrom,
  parseProviderAggregateStage,
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
    if (text === 'from' || text.startsWith('from ')) {
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
      const block = collectStatementBlock(lines, index);
      from = parseFrom(block, diagnostics);
      index = block.nextIndex;
      continue;
    }
    const providerBlock = collectStatementBlock(lines, index);
    const providerClause = parseProviderClause(providerBlock, diagnostics);
    if (providerClause) {
      stages.push(providerClause);
      index = providerBlock.nextIndex;
      continue;
    }
    if (text === 'then filter' || text.startsWith('then filter ')) {
      const block = collectStatementBlock(lines, index);
      const parsed = parseExpressionBlock(expressionBlockSlice(block, 'then filter '.length));
      diagnostics.push(...parsed.diagnostics);
      if (parsed.expression) {
        stages.push({
          column,
          expression: parsed.expression,
          kind: 'filter',
          line,
          range: block.range,
        });
      }
      index = block.nextIndex;
      continue;
    }
    if (text === 'then take' || text.startsWith('then take ')) {
      const block = collectStatementBlock(lines, index);
      stages.push({
        column,
        kind: 'take',
        line,
        range: block.range,
        value: Number(block.text.slice('then take '.length).trim()),
      });
      index = block.nextIndex;
      continue;
    }
    if (text === 'then sort by' || text.startsWith('then sort by ')) {
      const block = collectStatementBlock(lines, index);
      const parsed = parseSortBy(block, diagnostics);
      if (parsed) stages.push(parsed);
      index = block.nextIndex;
      continue;
    }
    if (text === 'then aggregate' || text.startsWith('then aggregate ')) {
      const aggregate = parseAggregateStage(lines, index, diagnostics);
      index = aggregate.nextIndex;
      stages.push(aggregate.stage);
      continue;
    }
    if (/^then\s+[A-Za-z_][A-Za-z0-9_]*\.aggregate\b/i.test(text)) {
      const aggregate = parseProviderAggregateStage(lines, index, diagnostics);
      index = aggregate.nextIndex;
      if (aggregate.stage) stages.push(aggregate.stage);
      continue;
    }
    if (text === 'then lookup' || text.startsWith('then lookup ')) {
      const lookup = parseLookup(lines, index, diagnostics);
      index = lookup.nextIndex;
      if (lookup.stage) stages.push(lookup.stage);
      continue;
    }
    if (text === 'then unwind' || text.startsWith('then unwind ')) {
      const block = collectStatementBlock(lines, index);
      const unwind = parseUnwind(block, diagnostics);
      if (unwind) stages.push(unwind);
      index = block.nextIndex;
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
        block.sourceLocations,
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
        block.sourceLocations,
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
