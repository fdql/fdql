import { parseFdql } from '@firebase-desk/fdql-core';
import type {
  FdqlAst,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlFromStage,
  FdqlProgram,
  FdqlProjectionItem,
  FdqlProviderAggregateYieldItem,
  FdqlSourceRange,
  FdqlStage,
  FdqlUnionProgram,
} from '@firebase-desk/fdql-core';

export interface FdqlQueryModel {
  readonly aliases: readonly FdqlQueryAlias[];
  readonly rows: readonly FdqlQueryRow[];
}

export interface FdqlQueryAlias {
  readonly isSource: boolean;
  readonly mask: FdqlFieldMask;
  readonly name: string;
}

export interface FdqlQueryRow {
  readonly mask: FdqlFieldMask;
  readonly name: string;
}

export type FdqlFieldMask =
  | { readonly kind: 'metadataOnly'; }
  | { readonly kind: 'masked'; readonly fields: readonly FdqlFieldNode[]; }
  | { readonly kind: 'unmasked'; };

export interface FdqlFieldNode {
  readonly children: readonly FdqlFieldNode[];
  readonly name: string;
}

export interface FdqlCursorPosition {
  readonly line: number;
}

interface FdqlFieldMaskDiagnostic extends FdqlDiagnostic {
  readonly endColumn?: number | undefined;
  readonly endLine?: number | undefined;
}

interface SourceSegment {
  readonly endLine: number;
  readonly startLine: number;
  readonly text: string;
}

export function createFdqlQueryModel(
  source: string,
  cursor?: FdqlCursorPosition | undefined,
): FdqlQueryModel {
  const branch = parseCursorBranch(source, cursor?.line);
  if (!branch) return { aliases: [], rows: [] };
  const aliases = aliasesForProgram(branch.program);
  return {
    aliases,
    rows: rowsForProgram(branch.program, aliasMap(aliases), branch.cursorLine),
  };
}

export function createFdqlFieldMaskDiagnostics(
  source: string,
): readonly FdqlFieldMaskDiagnostic[] {
  return parseAllBranches(source).flatMap((branch) => {
    const aliases = aliasesForProgram(branch.program);
    return fieldMaskDiagnosticsForProgram(branch.program, aliasMap(aliases), branch.lineOffset);
  });
}

export function fieldNamesAtPath(
  mask: FdqlFieldMask,
  path: readonly string[],
): readonly string[] {
  if (mask.kind !== 'masked') return [];
  let fields = mask.fields;
  for (const segment of path) {
    const next = fields.find((field) => field.name === segment);
    if (!next) return [];
    fields = next.children;
  }
  return fields.map((field) => field.name);
}

function parseCursorBranch(
  source: string,
  cursorLine = source.split(/\r?\n/).length,
): { readonly cursorLine: number; readonly program: FdqlProgram; } | null {
  const segments = splitUnionSegments(source);
  const selectedIndex = Math.max(
    0,
    segments.findIndex((segment) =>
      cursorLine >= segment.startLine && cursorLine <= segment.endLine
    ),
  );
  const selected = segments[selectedIndex] ?? segments[0];
  if (!selected) return null;
  const preamble = selectedIndex === 0 ? '' : sharedPreamble(segments[0]?.text ?? '');
  const parsed = parseFdqlPipelineText(selected.text, preamble);
  if (!parsed) return null;
  const prefixLines = lineCount(preamble);
  return {
    cursorLine: cursorLine - selected.startLine + 1 + prefixLines,
    program: parsed,
  };
}

function parseAllBranches(
  source: string,
): ReadonlyArray<{ readonly lineOffset: number; readonly program: FdqlProgram; }> {
  const segments = splitUnionSegments(source);
  const preamble = sharedPreamble(segments[0]?.text ?? '');
  return segments.flatMap((segment, index) => {
    const prefix = index === 0 ? '' : preamble;
    const program = parseFdqlPipelineText(segment.text, prefix);
    if (!program) return [];
    return [{
      lineOffset: segment.startLine - 1 - lineCount(prefix),
      program,
    }];
  });
}

function parseFdqlPipelineText(
  branchText: string,
  preamble: string,
): FdqlProgram | null {
  const source = preamble ? `${preamble}\n${branchText}` : branchText;
  const parsed = parseFdql(source);
  const ast = parsed.ast;
  if (!ast || isUnionAst(ast)) return null;
  return ast;
}

function splitUnionSegments(source: string): readonly SourceSegment[] {
  const segments: SourceSegment[] = [];
  const lines = source.split(/\r?\n/);
  let current: string[] = [];
  let startLine = 1;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim().toLowerCase() === 'union all') {
      segments.push({
        endLine: Math.max(startLine, lineNumber - 1),
        startLine,
        text: current.join('\n'),
      });
      current = [];
      startLine = lineNumber + 1;
      return;
    }
    current.push(line);
  });
  segments.push({
    endLine: Math.max(startLine, lines.length),
    startLine,
    text: current.join('\n'),
  });
  return segments.filter((segment) => segment.text.trim());
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

function lineCount(source: string): number {
  return source ? source.split(/\r?\n/).length : 0;
}

function isUnionAst(ast: FdqlAst): ast is FdqlUnionProgram {
  return 'kind' in ast && ast.kind === 'union';
}

function aliasesForProgram(program: FdqlProgram): readonly FdqlQueryAlias[] {
  return program.aliases.map((alias) => ({
    isSource: isSourceExpression(alias.value),
    mask: fieldMask(alias.value),
    name: alias.name,
  }));
}

function rowsForProgram(
  program: FdqlProgram,
  aliases: ReadonlyMap<string, FdqlQueryAlias>,
  cursorLine: number,
): readonly FdqlQueryRow[] {
  let rows = rowsAfterFrom(program.from, aliases, cursorLine);
  for (const stage of program.stages) {
    if (stage.line > cursorLine) break;
    if (rangeContainsLine(stage.range, cursorLine)) {
      return rowsForActiveStage(stage, rows, aliases);
    }
    rows = rowsAfterStage(stage, rows, aliases);
  }
  return uniqueRows(rows);
}

function rowsAfterFrom(
  from: FdqlFromStage | undefined,
  aliases: ReadonlyMap<string, FdqlQueryAlias>,
  cursorLine: number,
): readonly FdqlQueryRow[] {
  if (!from) return [];
  if (from.mode === 'aggregate') {
    if (rangeContainsLine(from.range, cursorLine)) {
      return from.providerRowAlias
        ? [{
          mask: sourceMask(from.sourceAlias, from.sourceExpression, aliases),
          name: from.providerRowAlias,
        }]
        : [];
    }
    return rowsForProviderAggregateYield(from.yieldItems ?? []);
  }
  return [{ mask: sourceMask(from.sourceAlias, undefined, aliases), name: from.rowAlias }];
}

function rowsForActiveStage(
  stage: FdqlStage,
  rows: readonly FdqlQueryRow[],
  aliases: ReadonlyMap<string, FdqlQueryAlias>,
): readonly FdqlQueryRow[] {
  if (stage.kind === 'lookup') {
    return uniqueRows([
      ...rows,
      {
        mask: sourceMask(stage.sourceAlias, stage.sourceExpression, aliases),
        name: stage.rowAlias,
      },
    ]);
  }
  if (stage.kind === 'providerAggregate' && stage.providerRowAlias) {
    return uniqueRows([
      ...rows,
      {
        mask: sourceMask(stage.sourceAlias, stage.sourceExpression, aliases),
        name: stage.providerRowAlias,
      },
    ]);
  }
  return rows;
}

function rowsAfterStage(
  stage: FdqlStage,
  rows: readonly FdqlQueryRow[],
  aliases: ReadonlyMap<string, FdqlQueryAlias>,
): readonly FdqlQueryRow[] {
  if (stage.kind === 'lookup') {
    return uniqueRows([
      ...rows,
      {
        mask: sourceMask(stage.sourceAlias, stage.sourceExpression, aliases),
        name: stage.rowAlias,
      },
    ]);
  }
  if (stage.kind === 'providerAggregate') {
    return uniqueRows([...rows, ...rowsForProviderAggregateYield(stage.yieldItems ?? [])]);
  }
  if (stage.kind === 'unwind') {
    return uniqueRows([
      ...rows,
      { mask: unwindMask(stage.expression), name: stage.rowAlias },
    ]);
  }
  if (stage.kind === 'with') {
    const projectionRows = rowsForProjection(stage.items);
    return hasWildcard(stage.items) ? uniqueRows([...rows, ...projectionRows]) : projectionRows;
  }
  if (stage.kind === 'aggregate') {
    return rowsForProjection([...stage.groups, ...stage.items]);
  }
  return rows;
}

function fieldMaskDiagnosticsForProgram(
  program: FdqlProgram,
  aliases: ReadonlyMap<string, FdqlQueryAlias>,
  lineOffset: number,
): readonly FdqlFieldMaskDiagnostic[] {
  const diagnostics: FdqlFieldMaskDiagnostic[] = [];
  let rows = rowsAfterFrom(program.from, aliases, Number.MAX_SAFE_INTEGER);
  for (const stage of program.stages) {
    const rowMap = rowMapByName(rows);
    if (stage.kind === 'filter' || stage.kind === 'sortBy' || stage.kind === 'unwind') {
      collectFieldMaskDiagnostics(stage.expression, rowMap, diagnostics, lineOffset);
    }
    if (stage.kind === 'with') {
      collectProjectionDiagnostics(stage.items, rowMap, diagnostics, lineOffset);
    }
    if (stage.kind === 'aggregate') {
      collectProjectionDiagnostics(
        [...stage.groups, ...stage.items],
        rowMap,
        diagnostics,
        lineOffset,
      );
    }
    if (stage.kind === 'return') {
      collectProjectionDiagnostics(stage.items, rowMap, diagnostics, lineOffset);
    }
    rows = rowsAfterStage(stage, rows, aliases);
  }
  return diagnostics;
}

function collectProjectionDiagnostics(
  items: readonly FdqlProjectionItem[],
  rows: ReadonlyMap<string, FdqlQueryRow>,
  diagnostics: FdqlFieldMaskDiagnostic[],
  lineOffset: number,
): void {
  for (const item of items) {
    if (item.spread || item.expression.kind === 'wildcard') continue;
    collectFieldMaskDiagnostics(item.expression, rows, diagnostics, lineOffset);
  }
}

function collectFieldMaskDiagnostics(
  expression: FdqlExpression,
  rows: ReadonlyMap<string, FdqlQueryRow>,
  diagnostics: FdqlFieldMaskDiagnostic[],
  lineOffset: number,
): void {
  if (expression.kind === 'field') {
    const [root, ...fieldPath] = expression.path;
    const row = root ? rows.get(root) : undefined;
    const unloadedSegmentIndex = row && fieldPath.length
      ? unloadedFieldSegmentIndex(row.mask, fieldPath)
      : -1;
    if (row && unloadedSegmentIndex >= 0) {
      const range = fieldSegmentRange(expression, unloadedSegmentIndex);
      diagnostics.push({
        code: 'FDQL_FIELD_NOT_IN_MASK',
        column: range?.startColumn ?? expression.range?.startColumn,
        endColumn: range?.endColumn ?? expression.range?.endColumn,
        endLine: range?.endLine ? range.endLine + lineOffset : expression.range?.endLine
          ? expression.range.endLine + lineOffset
          : undefined,
        line: range ? range.startLine + lineOffset : expression.range
          ? expression.range.startLine + lineOffset
          : undefined,
        message: `Field ${
          expression.path.join('.')
        } is outside the explicit field mask for ${root}.`,
        severity: 'warning',
      });
    }
    return;
  }
  if (expression.kind === 'call') {
    if (expression.name === 'mapGet' || expression.name.includes('.')) return;
    for (const arg of expression.args) {
      collectFieldMaskDiagnostics(arg, rows, diagnostics, lineOffset);
    }
    return;
  }
  if (expression.kind === 'array') {
    for (const item of expression.items) {
      collectFieldMaskDiagnostics(item, rows, diagnostics, lineOffset);
    }
    return;
  }
  if (expression.kind === 'map') {
    for (const entry of expression.entries) {
      collectFieldMaskDiagnostics(entry.value, rows, diagnostics, lineOffset);
    }
    return;
  }
  if (expression.kind === 'binary') {
    collectFieldMaskDiagnostics(expression.left, rows, diagnostics, lineOffset);
    collectFieldMaskDiagnostics(expression.right, rows, diagnostics, lineOffset);
    return;
  }
  if (expression.kind === 'unary' || expression.kind === 'postfix') {
    collectFieldMaskDiagnostics(expression.expression, rows, diagnostics, lineOffset);
    return;
  }
  if (expression.kind === 'case') {
    for (const branch of expression.branches) {
      collectFieldMaskDiagnostics(branch.condition, rows, diagnostics, lineOffset);
      collectFieldMaskDiagnostics(branch.value, rows, diagnostics, lineOffset);
    }
    if (expression.elseExpression) {
      collectFieldMaskDiagnostics(expression.elseExpression, rows, diagnostics, lineOffset);
    }
  }
}

function fieldPathIsLoaded(mask: FdqlFieldMask, path: readonly string[]): boolean {
  if (mask.kind !== 'masked') return true;
  return mask.fields.some((field) => maskNodeOverlapsPath(field, path));
}

function unloadedFieldSegmentIndex(mask: FdqlFieldMask, path: readonly string[]): number {
  if (fieldPathIsLoaded(mask, path) || mask.kind !== 'masked') return -1;
  let fields = mask.fields;
  for (let index = 0; index < path.length; index += 1) {
    const node = fields.find((field) => field.name === path[index]);
    if (!node) return index;
    if (!node.children.length) return -1;
    fields = node.children;
  }
  return -1;
}

function fieldSegmentRange(
  expression: Extract<FdqlExpression, { readonly kind: 'field'; }>,
  segmentIndex: number,
): FdqlSourceRange | undefined {
  if (!expression.range) return undefined;
  const pathIndex = segmentIndex + 1;
  const segment = expression.path[pathIndex];
  if (!segment) return expression.range;
  let startColumn = expression.range.startColumn;
  for (let index = 0; index < pathIndex; index += 1) {
    startColumn += expression.path[index]!.length + 1;
  }
  return {
    endColumn: startColumn + segment.length,
    endLine: expression.range.startLine,
    startColumn,
    startLine: expression.range.startLine,
  };
}

function maskNodeOverlapsPath(node: FdqlFieldNode, path: readonly string[]): boolean {
  if (node.name !== path[0]) return false;
  if (path.length === 1 || !node.children.length) return true;
  return node.children.some((child) => maskNodeOverlapsPath(child, path.slice(1)));
}

function sourceMask(
  sourceAlias: string,
  sourceExpression: FdqlExpression | undefined,
  aliases: ReadonlyMap<string, FdqlQueryAlias>,
): FdqlFieldMask {
  return sourceExpression
    ? fieldMask(sourceExpression)
    : aliases.get(sourceAlias)?.mask ?? unmasked();
}

function fieldMask(expression: FdqlExpression): FdqlFieldMask {
  if (expression.kind !== 'call') return unmasked();
  const maybeMask = expression.args.find((arg) => arg.kind === 'array');
  if (maybeMask?.kind !== 'array') return unmasked();
  if (!maybeMask.items.length) return { kind: 'metadataOnly' };
  return {
    fields: fieldTreeFromPaths(maybeMask.items.flatMap(maskPath)),
    kind: 'masked',
  };
}

function maskPath(expression: FdqlExpression): readonly string[][] {
  if (expression.kind === 'literal' && typeof expression.value === 'string') {
    return [expression.value.split('.').filter(Boolean)];
  }
  if (expression.kind === 'call' && expression.name.endsWith('.fieldPath')) {
    const segments = expression.args.flatMap((arg) =>
      arg.kind === 'literal' && typeof arg.value === 'string' ? [arg.value] : []
    );
    return segments.length ? [segments] : [];
  }
  return [];
}

interface MutableFieldNode {
  readonly children: Map<string, MutableFieldNode>;
  readonly name: string;
}

function fieldTreeFromPaths(paths: readonly string[][]): readonly FdqlFieldNode[] {
  const roots = new Map<string, MutableFieldNode>();
  for (const path of paths) insertFieldPath(roots, path);
  return freezeFieldNodes(roots);
}

function insertFieldPath(
  roots: Map<string, MutableFieldNode>,
  path: readonly string[],
): void {
  const [segment, ...rest] = path;
  if (!segment) return;
  const node = roots.get(segment) ?? { children: new Map(), name: segment };
  roots.set(segment, node);
  if (rest.length) insertFieldPath(node.children, rest);
}

function freezeFieldNodes(nodes: ReadonlyMap<string, MutableFieldNode>): readonly FdqlFieldNode[] {
  return [...nodes.values()].map((node) => ({
    children: freezeFieldNodes(node.children),
    name: node.name,
  }));
}

function rowsForProviderAggregateYield(
  items: readonly FdqlProviderAggregateYieldItem[],
): readonly FdqlQueryRow[] {
  const rows: FdqlQueryRow[] = [];
  for (const item of items) {
    if (item.kind === 'flat') {
      if (item.item.alias) rows.push({ mask: { kind: 'metadataOnly' }, name: item.item.alias });
      continue;
    }
    if (item.alias) {
      rows.push({
        mask: {
          fields: fieldTreeFromPaths(
            item.items.flatMap((field) => field.alias ? [[field.alias]] : []),
          ),
          kind: 'masked',
        },
        name: item.alias,
      });
    }
  }
  return rows;
}

function rowsForProjection(items: readonly FdqlProjectionItem[]): readonly FdqlQueryRow[] {
  return items.flatMap((item) => {
    if (item.expression.kind === 'wildcard') return [];
    const name = item.alias ?? item.label;
    return name ? [{ mask: { kind: 'metadataOnly' }, name }] : [];
  });
}

function unwindMask(expression: FdqlExpression): FdqlFieldMask {
  return expression.kind === 'call' && expression.name === 'entries'
    ? {
      fields: fieldTreeFromPaths([['key'], ['value']]),
      kind: 'masked',
    }
    : unmasked();
}

function hasWildcard(items: readonly FdqlProjectionItem[]): boolean {
  return items.some((item) => item.expression.kind === 'wildcard');
}

function isSourceExpression(expression: FdqlExpression): boolean {
  return expression.kind === 'call'
    && /\.(?:collection|collectionGroup|subcollection)$/.test(expression.name);
}

function rowMapByName(rows: readonly FdqlQueryRow[]): ReadonlyMap<string, FdqlQueryRow> {
  return new Map(rows.map((row) => [row.name, row]));
}

function aliasMap(aliases: readonly FdqlQueryAlias[]): ReadonlyMap<string, FdqlQueryAlias> {
  return new Map(aliases.map((alias) => [alias.name, alias]));
}

function uniqueRows(rows: readonly FdqlQueryRow[]): readonly FdqlQueryRow[] {
  return uniqueByName(rows);
}

function uniqueByName<const Item extends { readonly name: string; }>(
  items: readonly Item[],
): readonly Item[] {
  const seen = new Set<string>();
  const unique: Item[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    unique.push(item);
  }
  return unique;
}

function rangeContainsLine(range: FdqlSourceRange, line: number): boolean {
  return line >= range.startLine && line <= range.endLine;
}

function unmasked(): FdqlFieldMask {
  return { kind: 'unmasked' };
}
