import { builtinProviderDialects } from '@firebase-desk/fdql';
import { compileFdql as compileFdqlCore, fdqlCoreLanguageMetadata } from '@firebase-desk/fdql-core';
import type {
  FdqlCompileOptions,
  FdqlDefaultProviderContext,
  FdqlDiagnostic,
  FdqlProviderDialect,
  FdqlProviderLanguageClause,
  FdqlProviderLanguageItem,
} from '@firebase-desk/fdql-core';
import {
  createFdqlFieldMaskDiagnostics,
  createFdqlQueryModel,
  type FdqlQueryModel,
  fieldNamesAtPath,
} from './query-model.ts';

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
  readonly includeSnippets?: boolean | undefined;
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
  readonly aggregateFunctions: readonly FdqlCompletionItem[];
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

interface FdqlDiagnosticWithRange extends FdqlDiagnostic {
  readonly endColumn?: number | undefined;
  readonly endLine?: number | undefined;
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
      return [
        ...compileFdqlCore(source, compileOptions).diagnostics,
        ...createFdqlFieldMaskDiagnostics(source),
      ].map(toLanguageDiagnostic);
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
  const aggregateFunctions = sortCompletions(providers.flatMap(providerAggregateCompletions));
  const providerClauses = providers.flatMap(providerClauseCompletions);
  return {
    aggregateFunctions,
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
  const model = createFdqlQueryModel(input.source, { line: input.line });
  const line = lineBeforeCursor(input);
  const trimmed = line.trimStart();
  const lower = trimmed.toLowerCase();
  const dot = dotContext(line);
  const includeSnippets = input.includeSnippets === true;
  if (dot) return dotCompletions(metadata, model, dot, lower);
  if (lower.startsWith('set ')) return settingCompletions(metadata);
  if (lower.startsWith('clear ')) return clearCacheCompletions(lower);
  if (lower === 'from $' || lower.startsWith('from $')) return sourceAliasCompletions(model);
  if (lower.startsWith('from ')) return fromCompletions(metadata, model, includeSnippets);
  const provider = providerClauseNamespace(metadata, lower);
  if (lower.startsWith('alias ') && lower.includes('=')) {
    return sortCompletions([...metadata.sourceFunctions, ...metadata.expressionFunctions]);
  }
  if (lower.startsWith('then ')) {
    return thenCompletions(metadata, model, lower, includeSnippets);
  }
  if (provider) {
    return providerCompletions(metadata, model, lower, provider);
  }
  if (lower.startsWith('return ') || lower.includes(' where ')) {
    return expressionCompletions(metadata, model);
  }
  return sortCompletions([
    ...keywordCompletions(metadata),
    ...metadata.sourceFunctions,
    ...metadata.providerClauses,
    ...(includeSnippets ? metadata.snippets : []),
    ...metadata.expressionFunctions,
  ]);
}

function lineBeforeCursor(input: FdqlCompletionInput): string {
  const line = input.source.split(/\r?\n/)[Math.max(0, input.line - 1)] ?? '';
  return line.slice(0, Math.max(0, input.column - 1));
}

function clearCacheCompletions(
  line: string,
): readonly FdqlCompletionItem[] {
  if (line === 'clear ') {
    return [
      stageCompletion('cache', 'cache'),
      stageCompletion('cache provider fs', 'cache provider fs'),
      stageCompletion('cache provider fs project', 'cache provider fs project "project-id"'),
    ];
  }
  return [];
}

function settingCompletions(
  metadata: FdqlLanguageMetadata,
): readonly FdqlCompletionItem[] {
  return metadata.settings.map((item) => ({
    ...item,
    insertText: `${item.label} = `,
  }));
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

function fromCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
  includeSnippets: boolean,
): readonly FdqlCompletionItem[] {
  return sortCompletions([
    ...sourceAliasCompletions(model),
    ...providerNamespaces(metadata).flatMap((namespace) =>
      providerAggregateSourceCompletions(metadata, namespace)
    ),
    ...(includeSnippets
      ? metadata.snippets.filter((item) => item.label === 'from provider aggregate')
      : []),
  ]);
}

function thenCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
  line: string,
  includeSnippets: boolean,
): readonly FdqlCompletionItem[] {
  if (
    /^then\s+lookup\s+(?:required\s+one\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*|one\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*|many\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*)\s+cache\s*$/i
      .test(line)
    || /^then\s+[A-Za-z_][A-Za-z0-9_]*\.aggregate\s+.+\s+cache\s*$/i.test(line)
  ) {
    return lookupCacheModeCompletions();
  }
  if (
    /^then\s+lookup\s+(?:required\s+one\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*|one\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*|many\s+\$[A-Za-z_][A-Za-z0-9_]*\s+as\s+[A-Za-z_][A-Za-z0-9_]*)\s*$/i
      .test(line)
    || /^then\s+[A-Za-z_][A-Za-z0-9_]*\.aggregate\s+.+(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/i
      .test(line)
  ) {
    return lookupCacheCompletions();
  }
  if (/^then\s+lookup\s+(?:required\s+one|one|many)\s+\$/i.test(line)) {
    return sourceAliasCompletions(model);
  }
  if (/^then\s+[A-Za-z_][A-Za-z0-9_]*\.aggregate\s+\$/i.test(line)) {
    return sourceAliasCompletions(model);
  }
  if (/^yield\s+/i.test(line)) return aggregateExpressionCompletions(metadata, model);
  if (
    /^then\s+(?:filter|sort by|unwind|with)\s+/i.test(line)
    || line === 'then with'
  ) {
    return expressionCompletions(metadata, model);
  }
  if (/^then\s+take\s+/i.test(line)) return [];
  return sortCompletions([
    ...localStageCompletions(),
    ...providerAggregateStageCompletions(metadata),
    ...providerNamespaces(metadata).flatMap((namespace) =>
      providerClauseSuffixCompletions(metadata, namespace)
    ),
    ...(includeSnippets ? metadata.snippets.filter((item) => item.label.startsWith('then ')) : []),
  ]);
}

function aggregateExpressionCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
): readonly FdqlCompletionItem[] {
  return sortCompletions([
    ...rowAliasCompletions(model),
    ...scalarAliasCompletions(model),
    ...metadata.aggregateFunctions,
  ]);
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
  if (line === `${provider} `) return providerClauseSuffixCompletions(metadata, provider);
  const activeClause = clauses.find((item) =>
    line === item.label || line.startsWith(`${item.label} `)
  );
  if (!activeClause) return clauses;
  if (activeClause.label.endsWith(' limit')) return [];
  return expressionCompletions(metadata, model);
}

function localStageCompletions(): readonly FdqlCompletionItem[] {
  return [
    stageCompletion('aggregate', 'aggregate\n  by '),
    stageCompletion('filter', 'filter '),
    stageCompletion('lookup many', 'lookup many '),
    stageCompletion('lookup one', 'lookup one '),
    stageCompletion('lookup required one', 'lookup required one '),
    stageCompletion('sort by', 'sort by '),
    stageCompletion('take', 'take '),
    stageCompletion('unwind', 'unwind '),
    stageCompletion('with', 'with '),
  ];
}

function providerAggregateStageCompletions(
  metadata: FdqlLanguageMetadata,
): readonly FdqlCompletionItem[] {
  return providerNamespaces(metadata)
    .filter((namespace) =>
      metadata.aggregateFunctions.some((item) => item.label === `${namespace}.count`)
    )
    .map((namespace) => ({
      detail: 'Provider aggregate stage',
      insertText:
        `${namespace}.aggregate $source of parent as row\n  yield ${namespace}.count() as total`,
      kind: 'stage',
      label: 'then provider aggregate',
    }));
}

function providerClauseSuffixCompletions(
  metadata: FdqlLanguageMetadata,
  provider: string,
): readonly FdqlCompletionItem[] {
  return metadata.providerClauses
    .filter((item) => item.label.startsWith(`${provider} `))
    .map((item) => {
      const label = item.label.slice(provider.length + 1);
      const insertText = item.insertText.startsWith(`${provider} `)
        ? item.insertText.slice(provider.length + 1)
        : label;
      return { ...item, insertText, label };
    });
}

function keywordCompletions(metadata: FdqlLanguageMetadata): readonly FdqlCompletionItem[] {
  return metadata.keywords.map((keyword) => ({
    insertText: keyword,
    kind: 'keyword',
    label: keyword,
  }));
}

interface QueryModel {
  readonly aliases: FdqlQueryModel['aliases'];
  readonly rows: FdqlQueryModel['rows'];
}

interface DotContext {
  readonly path: readonly string[];
  readonly root: string;
  readonly namespace: boolean;
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
  const match =
    /((?:[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.$/.exec(
      line,
    );
  if (!match) return line.endsWith('.') ? { namespace: false, path: [], root: '' } : null;
  const [root = '', ...path] = match[1]!.split('.');
  return {
    namespace: !root.startsWith('$') && !path.length && /^[a-z][a-z0-9_]*$/i.test(root),
    path,
    root,
  };
}

function dotCompletions(
  metadata: FdqlLanguageMetadata,
  model: QueryModel,
  dot: DotContext,
  lowerLine: string,
): readonly FdqlCompletionItem[] {
  if (!dot.root) return [];
  if (dot.namespace && isProviderNamespace(metadata, dot.root)) {
    return lowerLine.startsWith('alias ')
      ? metadata.sourceFunctions.filter((item) => item.label.startsWith(`${dot.root}.`))
      : lowerLine.startsWith('from ')
      ? providerAggregateSourceCompletions(metadata, dot.root)
      : lowerLine.startsWith(`then ${dot.root}.aggregate`)
      ? providerAggregateSourceCompletions(metadata, dot.root)
      : lowerLine.trimStart().startsWith('yield ')
      ? metadata.aggregateFunctions.filter((item) => item.label.startsWith(`${dot.root}.`))
      : metadata.expressionFunctions.filter((item) => item.label.startsWith(`${dot.root}.`));
  }
  const row = model.rows.find((candidate) => candidate.name === dot.root);
  return row ? fieldCompletions(fieldNamesAtPath(row.mask, dot.path)) : [];
}

function providerAggregateSourceCompletions(
  metadata: FdqlLanguageMetadata,
  provider: string,
): readonly FdqlCompletionItem[] {
  return metadata.aggregateFunctions.some((item) => item.label === `${provider}.count`)
    ? [{
      detail: 'Provider aggregate source',
      insertText: `${provider}.aggregate $source as row\n  yield ${provider}.count() as total`,
      kind: 'function',
      label: `${provider}.aggregate`,
    }]
    : [];
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

function providerNamespaces(metadata: FdqlLanguageMetadata): readonly string[] {
  return uniqueByName(
    metadata.providerClauses.flatMap((item) => {
      const namespace = /^([a-z][a-z0-9_]*)\s/i.exec(item.label)?.[1];
      return namespace ? [{ name: namespace }] : [];
    }),
  ).map((item) => item.name);
}

function isProviderNamespace(metadata: FdqlLanguageMetadata, name: string): boolean {
  return [...metadata.sourceFunctions, ...metadata.expressionFunctions].some((item) =>
    item.label.startsWith(`${name}.`)
  ) || metadata.aggregateFunctions.some((item) => item.label.startsWith(`${name}.`));
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

function providerAggregateCompletions(
  provider: FdqlProviderDialect,
): readonly FdqlCompletionItem[] {
  const metadata = provider.language?.aggregateFunctions;
  if (metadata?.length) return metadata.map((item) => itemCompletion(item, 'function'));
  return [...(provider.aggregateFunctions ?? [])].map((name) =>
    functionCompletion(name, `${name}($1)`)
  );
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
    insertText: plainInsertText(clause.insertText ?? `${provider.namespace} ${clause.keyword} `),
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
    insertText: kind === 'snippet'
      ? item.insertText ?? item.name
      : plainInsertText(item.insertText ?? item.name),
    kind,
    label: item.label ?? item.name,
  };
}

function functionCompletion(label: string, insertText: string): FdqlCompletionItem {
  return { insertText: plainInsertText(insertText), kind: 'function', label };
}

function stageCompletion(label: string, insertText = label): FdqlCompletionItem {
  return { insertText, kind: 'stage', label };
}

function plainInsertText(insertText: string): string {
  return insertText
    .replace(/\$\{\d+\|([^}]+)\|\}/g, (_match, options: string) => options.split(',')[0] ?? '')
    .replace(/\$\{\d+:([^}]+)\}/g, (_match, value: string) => value)
    .replace(/\$\{\d+\}/g, '');
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

function toLanguageDiagnostic(diagnostic: FdqlDiagnosticWithRange): FdqlLanguageDiagnostic {
  const line = diagnostic.line ?? 1;
  const column = diagnostic.column ?? 1;
  return {
    ...diagnostic,
    column,
    endColumn: diagnostic.endColumn ?? column + 1,
    endLine: diagnostic.endLine ?? line,
    line,
  };
}
