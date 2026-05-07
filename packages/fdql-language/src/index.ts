import { builtinProviderDialects } from '@firebase-desk/fdql';
import {
  compileFdql as compileFdqlCore,
  fdqlCoreLanguageMetadata,
  parseFdql,
} from '@firebase-desk/fdql-core';
import type {
  FdqlAst,
  FdqlCompileOptions,
  FdqlDefaultProviderContext,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlProgram,
  FdqlProviderDialect,
  FdqlProviderLanguageClause,
  FdqlProviderLanguageItem,
  FdqlUnionProgram,
} from '@firebase-desk/fdql-core';

export const FDQL_LANGUAGE_ID = 'fdql';

export type FdqlCompletionKind =
  | 'alias'
  | 'field'
  | 'function'
  | 'keyword'
  | 'setting'
  | 'snippet'
  | 'stage';

export interface FdqlCompletionItem {
  readonly detail?: string | undefined;
  readonly documentation?: string | undefined;
  readonly insertText: string;
  readonly kind: FdqlCompletionKind;
  readonly label: string;
}

export interface FdqlCompletionInput {
  readonly column: number;
  readonly line: number;
  readonly source: string;
}

export interface FdqlLanguageDiagnostic extends FdqlDiagnostic {
  readonly endColumn: number;
  readonly endLine: number;
  readonly line: number;
  readonly column: number;
}

export interface FdqlLanguageMetadata {
  readonly expressionFunctions: readonly FdqlCompletionItem[];
  readonly keywords: readonly string[];
  readonly providerClauses: readonly FdqlCompletionItem[];
  readonly settings: readonly FdqlCompletionItem[];
  readonly snippets: readonly FdqlCompletionItem[];
  readonly sourceFunctions: readonly FdqlCompletionItem[];
}

export interface FdqlLanguageService {
  readonly metadata: FdqlLanguageMetadata;
  readonly getCompletions: (input: FdqlCompletionInput) => readonly FdqlCompletionItem[];
  readonly getDiagnostics: (
    source: string,
    options?: FdqlLanguageDiagnosticOptions,
  ) => readonly FdqlLanguageDiagnostic[];
}

export interface FdqlLanguageServiceOptions {
  readonly defaultProviderContext?: FdqlDefaultProviderContext | undefined;
  readonly providers?: readonly FdqlProviderDialect[] | undefined;
}

export interface FdqlLanguageDiagnosticOptions {
  readonly defaultProviderContext?: FdqlDefaultProviderContext | undefined;
}

export function createFdqlLanguageService(
  options: FdqlLanguageServiceOptions = {},
): FdqlLanguageService {
  const providers = [...(options.providers ?? builtinProviderDialects)];
  const metadata = buildMetadata(providers);

  return {
    metadata,
    getCompletions(input) {
      return completionsForInput(metadata, input);
    },
    getDiagnostics(source, diagnosticOptions) {
      const defaultProviderContext = diagnosticOptions?.defaultProviderContext
        ?? options.defaultProviderContext;
      const compileOptions: FdqlCompileOptions = {
        providers,
        ...(defaultProviderContext ? { defaultProviderContext } : {}),
      };
      return compileFdqlCore(source, compileOptions).diagnostics.map(toLanguageDiagnostic);
    },
  };
}

function buildMetadata(providers: readonly FdqlProviderDialect[]): FdqlLanguageMetadata {
  const coreSettings = fdqlCoreLanguageMetadata.settings.map((item) =>
    itemCompletion(item, 'setting')
  );
  const coreExpressionFunctions = fdqlCoreLanguageMetadata.expressionFunctions.map((item) =>
    itemCompletion(item, 'function')
  );
  const coreSnippets = fdqlCoreLanguageMetadata.snippets.map((item) =>
    itemCompletion(item, 'snippet')
  );
  const providerSettings = providers.flatMap((provider) =>
    (provider.language?.settings ?? []).map((item) => itemCompletion(item, 'setting'))
  );
  const sourceFunctions = providers.flatMap(providerSourceCompletions);
  const valueFunctions = providers.flatMap(providerValueCompletions);
  const providerClauses = providers.flatMap(providerClauseCompletions);
  return {
    expressionFunctions: sortCompletions([...coreExpressionFunctions, ...valueFunctions]),
    keywords: [...fdqlCoreLanguageMetadata.keywords],
    providerClauses: sortCompletions(providerClauses),
    settings: sortCompletions([...coreSettings, ...providerSettings]),
    snippets: [...coreSnippets],
    sourceFunctions: sortCompletions(sourceFunctions),
  };
}

function completionsForInput(
  metadata: FdqlLanguageMetadata,
  input: FdqlCompletionInput,
): readonly FdqlCompletionItem[] {
  const model = queryModel(input.source);
  const line = lineBeforeCursor(input);
  const trimmed = line.trimStart();
  const lower = trimmed.toLowerCase();
  const dot = dotContext(line);
  if (dot) return dotCompletions(metadata, model, dot, lower);
  if (lower.startsWith('set ')) return metadata.settings;
  if (lower.startsWith('clear ')) return clearCacheCompletions(metadata);
  if (lower === 'from $' || lower.startsWith('from $')) return sourceAliasCompletions(model);
  const provider = providerClauseNamespace(metadata, lower);
  if (lower.startsWith('alias ') && lower.includes('=')) {
    return sortCompletions([...metadata.sourceFunctions, ...metadata.expressionFunctions]);
  }
  if (lower.startsWith('then ')) {
    return thenCompletions(metadata, model, lower);
  }
  if (provider) {
    return providerCompletions(metadata, model, lower, provider);
  }
  if (lower.startsWith('return ') || lower.includes(' where ')) {
    return expressionCompletions(metadata, model);
  }
  return sortCompletions([
    ...metadata.settings,
    ...metadata.sourceFunctions,
    ...metadata.providerClauses,
    ...metadata.snippets,
    ...metadata.expressionFunctions,
  ]);
}

function lineBeforeCursor(input: FdqlCompletionInput): string {
  const line = input.source.split(/\r?\n/)[Math.max(0, input.line - 1)] ?? '';
  return line.slice(0, Math.max(0, input.column - 1));
}

function clearCacheCompletions(
  metadata: FdqlLanguageMetadata,
): readonly FdqlCompletionItem[] {
  return metadata.snippets.filter((item) => item.label.startsWith('clear cache'));
}

function expressionCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
): readonly FdqlCompletionItem[] {
  return sortCompletions([
    ...rowAliasCompletions(model),
    ...scalarAliasCompletions(model),
    ...metadata.expressionFunctions,
  ]);
}

function thenCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
  line: string,
): readonly FdqlCompletionItem[] {
  if (
    /^then\s+lookup\s+(?:one|many)\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+cache\s*$/i
      .test(line)
  ) {
    return lookupCacheModeCompletions();
  }
  if (
    /^then\s+lookup\s+(?:one|many)\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/i
      .test(line)
  ) {
    return lookupCacheCompletions();
  }
  if (/^then\s+lookup\s+(?:one|many)\s+\$/i.test(line)) return sourceAliasCompletions(model);
  if (
    /^then\s+(?:filter|sort by|unwind|with)\s+/i.test(line)
    || line === 'then with'
  ) {
    return expressionCompletions(metadata, model);
  }
  if (/^then\s+take\s+/i.test(line)) return [];
  return sortCompletions([...metadata.snippets, ...metadata.providerClauses]);
}

function lookupCacheCompletions(): readonly FdqlCompletionItem[] {
  return [
    {
      detail: 'Use per-run lookup dedupe for this lookup',
      insertText: 'cache run',
      kind: 'keyword',
      label: 'cache run',
    },
    {
      detail: 'Use persistent lookup cache for this lookup',
      insertText: 'cache persistent',
      kind: 'keyword',
      label: 'cache persistent',
    },
    {
      detail: 'Disable lookup dedupe for this lookup',
      insertText: 'cache off',
      kind: 'keyword',
      label: 'cache off',
    },
  ];
}

function lookupCacheModeCompletions(): readonly FdqlCompletionItem[] {
  return [
    {
      detail: 'Use per-run lookup dedupe for this lookup',
      insertText: 'run',
      kind: 'keyword',
      label: 'run',
    },
    {
      detail: 'Use persistent lookup cache for this lookup',
      insertText: 'persistent',
      kind: 'keyword',
      label: 'persistent',
    },
    {
      detail: 'Disable lookup dedupe for this lookup',
      insertText: 'off',
      kind: 'keyword',
      label: 'off',
    },
  ];
}

function providerCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
  line: string,
  provider: string,
): readonly FdqlCompletionItem[] {
  const clauses = metadata.providerClauses.filter((item) => item.label.startsWith(`${provider} `));
  const activeClause = clauses.find((item) =>
    line === item.label || line.startsWith(`${item.label} `)
  );
  if (!activeClause) return clauses;
  if (activeClause.label.endsWith(' limit')) return [];
  return expressionCompletions(metadata, model);
}

interface QueryModel {
  readonly aliases: readonly QueryAlias[];
  readonly rows: readonly QueryRow[];
}

interface QueryAlias {
  readonly fields: readonly string[];
  readonly isSource: boolean;
  readonly name: string;
}

interface QueryRow {
  readonly fields: readonly string[];
  readonly name: string;
}

interface DotContext {
  readonly name: string;
  readonly namespace: boolean;
}

function queryModel(source: string): QueryModel {
  const parsed = parseFdql(source);
  const programs = parsed.ast
    ? isUnionAst(parsed.ast) ? parsed.ast.branches : [parsed.ast]
    : [];
  const aliases = programs.flatMap((program) => aliasesForProgram(program));
  const aliasByName = new Map(aliases.map((alias) => [alias.name, alias]));
  const rows = programs.flatMap((program) => rowsForProgram(program, aliasByName));
  return { aliases: uniqueByName(aliases), rows: uniqueByName(rows) };
}

function isUnionAst(ast: FdqlAst): ast is FdqlUnionProgram {
  return 'kind' in ast && ast.kind === 'union';
}

function aliasesForProgram(program: FdqlProgram): readonly QueryAlias[] {
  return program.aliases.map((alias) => ({
    fields: fieldMask(alias.value),
    isSource: isSourceExpression(alias.value),
    name: alias.name,
  }));
}

function rowsForProgram(
  program: FdqlProgram,
  aliases: ReadonlyMap<string, QueryAlias>,
): readonly QueryRow[] {
  const rows: QueryRow[] = [];
  if (program.from) {
    rows.push({
      fields: aliases.get(program.from.sourceAlias)?.fields ?? [],
      name: program.from.rowAlias,
    });
  }
  for (const stage of program.stages) {
    if (stage.kind === 'lookup') {
      rows.push({
        fields: aliases.get(stage.sourceAlias)?.fields ?? [],
        name: stage.rowAlias,
      });
    }
    if (stage.kind === 'unwind') {
      rows.push({
        fields: unwindFields(stage.expression),
        name: stage.rowAlias,
      });
    }
  }
  return rows;
}

function fieldMask(expression: FdqlExpression): readonly string[] {
  if (expression.kind !== 'call') return [];
  const maybeMask = expression.args.find((arg) => arg.kind === 'array');
  if (maybeMask?.kind !== 'array') return [];
  return maybeMask.items.flatMap((item) =>
    item.kind === 'literal' && typeof item.value === 'string' ? [item.value] : []
  );
}

function isSourceExpression(expression: FdqlExpression): boolean {
  return expression.kind === 'call'
    && /\.(?:collection|collectionGroup|subcollection)$/.test(expression.name);
}

function unwindFields(expression: FdqlExpression): readonly string[] {
  return expression.kind === 'call' && expression.name === 'entries' ? ['key', 'value'] : [];
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

function dotContext(line: string): DotContext | null {
  const match = /([A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*)\.$/.exec(line);
  if (!match) return line.endsWith('.') ? { name: '', namespace: false } : null;
  const name = match[1]!;
  return { name, namespace: !name.startsWith('$') && /^[a-z][a-z0-9_]*$/i.test(name) };
}

function dotCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
  dot: DotContext,
  lowerLine: string,
): readonly FdqlCompletionItem[] {
  if (!dot.name) return [];
  if (isProviderNamespace(metadata, dot.name)) {
    return lowerLine.startsWith('alias ')
      ? metadata.sourceFunctions.filter((item) => item.label.startsWith(`${dot.name}.`))
      : metadata.expressionFunctions.filter((item) => item.label.startsWith(`${dot.name}.`));
  }
  const row = model.rows.find((candidate) => candidate.name === dot.name);
  return row ? fieldCompletions(row.fields) : [];
}

function sourceAliasCompletions(model: QueryModel): readonly FdqlCompletionItem[] {
  return model.aliases.filter((alias) => alias.isSource).map((alias) => ({
    insertText: alias.name,
    kind: 'alias',
    label: alias.name,
  }));
}

function providerClauseNamespace(metadata: FdqlLanguageMetadata, line: string): string | null {
  const namespace = /^([a-z][a-z0-9_]*)\s/i.exec(line)?.[1];
  if (!namespace) return null;
  return metadata.providerClauses.some((item) => item.label.startsWith(`${namespace} `))
    ? namespace
    : null;
}

function isProviderNamespace(metadata: FdqlLanguageMetadata, name: string): boolean {
  return [...metadata.sourceFunctions, ...metadata.expressionFunctions].some((item) =>
    item.label.startsWith(`${name}.`)
  );
}

function scalarAliasCompletions(model: QueryModel): readonly FdqlCompletionItem[] {
  return model.aliases.filter((alias) => !alias.isSource).map((alias) => ({
    insertText: alias.name,
    kind: 'alias',
    label: alias.name,
  }));
}

function rowAliasCompletions(model: QueryModel): readonly FdqlCompletionItem[] {
  return model.rows.map((row) => ({
    insertText: row.name,
    kind: 'alias',
    label: row.name,
  }));
}

function fieldCompletions(fields: readonly string[]): readonly FdqlCompletionItem[] {
  return fields.map((field) => ({
    insertText: field,
    kind: 'field',
    label: field,
  }));
}

function providerSourceCompletions(
  provider: FdqlProviderDialect,
): readonly FdqlCompletionItem[] {
  const metadata = provider.language?.sourceFunctions;
  if (metadata?.length) return metadata.map((item) => itemCompletion(item, 'function'));
  return [...provider.sourceFunctions].map((name) =>
    functionCompletion(`${provider.namespace}.${name}`, `${provider.namespace}.${name}($1)`)
  );
}

function providerValueCompletions(
  provider: FdqlProviderDialect,
): readonly FdqlCompletionItem[] {
  const metadata = provider.language?.valueFunctions;
  if (metadata?.length) return metadata.map((item) => itemCompletion(item, 'function'));
  return [...provider.valueFunctions].map((name) => functionCompletion(name, `${name}($1)`));
}

function providerClauseCompletions(
  provider: FdqlProviderDialect,
): readonly FdqlCompletionItem[] {
  return (provider.language?.clauses ?? []).map((clause) => clauseCompletion(provider, clause));
}

function clauseCompletion(
  provider: FdqlProviderDialect,
  clause: FdqlProviderLanguageClause,
): FdqlCompletionItem {
  return {
    ...(clause.detail ? { detail: clause.detail } : {}),
    ...(clause.documentation ? { documentation: clause.documentation } : {}),
    insertText: clause.insertText ?? `${provider.namespace} ${clause.keyword} `,
    kind: 'stage',
    label: clause.label ?? `${provider.namespace} ${clause.keyword}`,
  };
}

function itemCompletion(
  item: FdqlProviderLanguageItem,
  kind: FdqlCompletionKind,
): FdqlCompletionItem {
  return {
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.documentation ? { documentation: item.documentation } : {}),
    insertText: item.insertText ?? item.name,
    kind,
    label: item.label ?? item.name,
  };
}

function functionCompletion(label: string, insertText: string): FdqlCompletionItem {
  return { insertText, kind: 'function', label };
}

function sortCompletions(items: readonly FdqlCompletionItem[]): readonly FdqlCompletionItem[] {
  const sorted: FdqlCompletionItem[] = [];
  for (const item of items) {
    const index = sorted.findIndex((candidate) => item.label.localeCompare(candidate.label) < 0);
    if (index < 0) sorted.push(item);
    else sorted.splice(index, 0, item);
  }
  return sorted;
}

function toLanguageDiagnostic(diagnostic: FdqlDiagnostic): FdqlLanguageDiagnostic {
  const line = diagnostic.line ?? 1;
  const column = diagnostic.column ?? 1;
  return {
    ...diagnostic,
    column,
    endColumn: column + 1,
    endLine: line,
    line,
  };
}
