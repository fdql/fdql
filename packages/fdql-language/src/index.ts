import { builtinProviderDialects } from '@firebase-desk/fdql';
import { compileFdqlRead as compileFdqlReadCore } from '@firebase-desk/fdql-core';
import type {
  FdqlCompileOptions,
  FdqlDefaultProviderContext,
  FdqlDiagnostic,
  FdqlProviderDialect,
  FdqlProviderLanguageClause,
  FdqlProviderLanguageItem,
} from '@firebase-desk/fdql-core';

export const FDQL_LANGUAGE_ID = 'fdql';

export type FdqlCompletionKind =
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

const coreKeywords = [
  'alias',
  'and',
  'as',
  'by',
  'desc',
  'from',
  'in',
  'or',
  'return',
  'set',
  'then',
  'union all',
] as const;

const coreSettings: readonly FdqlCompletionItem[] = [
  {
    detail: 'Maximum documents read by this query',
    insertText: 'set fdql.readBudget = ${1:5000}',
    kind: 'setting',
    label: 'fdql.readBudget',
  },
  {
    detail: 'Maximum query runtime',
    insertText: 'set fdql.timeout = "${1:60s}"',
    kind: 'setting',
    label: 'fdql.timeout',
  },
  {
    detail: 'Read cache mode',
    insertText: 'set fdql.cache = "${1|off,run,session|}"',
    kind: 'setting',
    label: 'fdql.cache',
  },
  {
    detail: 'Allow provider reads that are not bounded by provider clauses',
    insertText: 'set fdql.allowUnboundedReads = ${1:false}',
    kind: 'setting',
    label: 'fdql.allowUnboundedReads',
  },
];

const coreExpressionFunctions: readonly FdqlCompletionItem[] = [
  functionCompletion('timestamp', 'timestamp("${1:2026-01-01T00:00:00.000Z}")'),
  functionCompletion('bytes', 'bytes("${1:base64:SGVsbG8=}")'),
  functionCompletion('geoPoint', 'geoPoint(${1:0}, ${2:0})'),
  functionCompletion('lower', 'lower(${1:value})'),
  functionCompletion('entries', 'entries(${1:map})'),
  functionCompletion('mapGet', 'mapGet(${1:map}, ${2:key})'),
  functionCompletion('count', 'count()'),
  functionCompletion('sum', 'sum(${1:value})'),
  functionCompletion('avg', 'avg(${1:value})'),
  functionCompletion('min', 'min(${1:value})'),
  functionCompletion('max', 'max(${1:value})'),
];

const coreSnippets: readonly FdqlCompletionItem[] = [
  snippetCompletion('set', 'set fdql.readBudget = ${1:5000}'),
  snippetCompletion('alias', 'alias $${1:source} = ${2:fs.collection("${3:collection}")}'),
  snippetCompletion('from', 'from $${1:source} as ${2:row}'),
  snippetCompletion('then filter', 'then filter ${1:expression}'),
  snippetCompletion('then take', 'then take ${1:25}'),
  snippetCompletion('then with', 'then with ${1:expression} as ${2:name}'),
  snippetCompletion('then sort by', 'then sort by ${1:field} ${2|asc,desc|}'),
  snippetCompletion('then lookup one', 'then lookup one $${1:source} as ${2:row}'),
  snippetCompletion('then lookup many', 'then lookup many $${1:source} as ${2:rows}'),
  snippetCompletion('then unwind', 'then unwind ${1:expression} as ${2:item}'),
  snippetCompletion(
    'then aggregate',
    'then aggregate\n  by ${1:field} as ${2:key}\n  count() as total',
  ),
  snippetCompletion('return', 'return ${1:*}'),
  snippetCompletion('union all', 'union all'),
];

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
      return compileFdqlReadCore(source, compileOptions).diagnostics.map(toLanguageDiagnostic);
    },
  };
}

function buildMetadata(providers: readonly FdqlProviderDialect[]): FdqlLanguageMetadata {
  const providerSettings = providers.flatMap((provider) =>
    (provider.language?.settings ?? []).map((item) => itemCompletion(item, 'setting'))
  );
  const sourceFunctions = providers.flatMap(providerSourceCompletions);
  const valueFunctions = providers.flatMap(providerValueCompletions);
  const providerClauses = providers.flatMap(providerClauseCompletions);
  return {
    expressionFunctions: sortCompletions([...coreExpressionFunctions, ...valueFunctions]),
    keywords: [...coreKeywords],
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
  const beforeCursor = lineBeforeCursor(input).trimStart().toLowerCase();
  if (beforeCursor.startsWith('set ')) return metadata.settings;
  if (beforeCursor.startsWith('alias ') && beforeCursor.includes('=')) {
    return sortCompletions([...metadata.sourceFunctions, ...metadata.expressionFunctions]);
  }
  if (beforeCursor.startsWith('then ')) {
    return sortCompletions([...metadata.snippets, ...metadata.providerClauses]);
  }
  if (beforeCursor.startsWith('return ') || beforeCursor.includes(' where ')) {
    return metadata.expressionFunctions;
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

function snippetCompletion(label: string, insertText: string): FdqlCompletionItem {
  return { insertText, kind: 'snippet', label };
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
