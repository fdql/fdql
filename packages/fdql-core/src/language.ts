import type { FdqlProviderLanguageItem } from './provider.ts';

export const fdqlCoreKeywords = [
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

export type FdqlCoreKeyword = typeof fdqlCoreKeywords[number];

const fdqlCoreSettingByName = {
  'fdql.allowUnboundedReads': {
    detail: 'Allow provider reads that are not bounded by provider clauses',
    insertText: 'set fdql.allowUnboundedReads = ${1:false}',
  },
  'fdql.cache': {
    detail: 'Read cache mode',
    insertText: 'set fdql.cache = ${1|off,run|}',
  },
  'fdql.readBudget': {
    detail: 'Maximum documents read by this query',
    insertText: 'set fdql.readBudget = ${1:5000}',
  },
  'fdql.timeout': {
    detail: 'Maximum query runtime',
    insertText: 'set fdql.timeout = ${1:60s}',
  },
} as const;

export type FdqlCoreSettingKey = keyof typeof fdqlCoreSettingByName;

export const fdqlCoreSettingKeys = recordKeys(fdqlCoreSettingByName);

const fdqlCoreExpressionFunctionByName = {
  timestamp: {
    insertText: 'timestamp("${1:2026-01-01T00:00:00.000Z}")',
  },
  bytes: {
    insertText: 'bytes("${1:base64:SGVsbG8=}")',
  },
  geoPoint: {
    insertText: 'geoPoint(${1:0}, ${2:0})',
  },
  lower: {
    insertText: 'lower(${1:value})',
  },
  entries: {
    insertText: 'entries(${1:map})',
  },
  mapGet: {
    insertText: 'mapGet(${1:map}, ${2:key})',
  },
  count: {
    insertText: 'count()',
  },
  sum: {
    insertText: 'sum(${1:value})',
  },
  avg: {
    insertText: 'avg(${1:value})',
  },
  min: {
    insertText: 'min(${1:value})',
  },
  max: {
    insertText: 'max(${1:value})',
  },
} as const;

export type FdqlCoreExpressionFunctionName = keyof typeof fdqlCoreExpressionFunctionByName;

export const fdqlCoreExpressionFunctionNames = recordKeys(
  fdqlCoreExpressionFunctionByName,
);

const fdqlCoreSnippetByName = {
  alias: {
    insertText: 'alias $${1:source} = ${2:fs.collection("${3:collection}")}',
  },
  from: {
    insertText: 'from $${1:source} as ${2:row}',
  },
  return: {
    insertText: 'return ${1:*}',
  },
  set: {
    insertText: 'set fdql.readBudget = ${1:5000}',
  },
  'then aggregate': {
    insertText: 'then aggregate\n  by ${1:field} as ${2:key}\n  count() as total',
  },
  'then filter': {
    insertText: 'then filter ${1:expression}',
  },
  'then lookup many': {
    insertText: 'then lookup many $${1:source} as ${2:rows}',
  },
  'then lookup many cache': {
    insertText: 'then lookup many $${1:source} as ${2:rows} cache ${3|run,off|}',
  },
  'then lookup one': {
    insertText: 'then lookup one $${1:source} as ${2:row}',
  },
  'then lookup one cache': {
    insertText: 'then lookup one $${1:source} as ${2:row} cache ${3|run,off|}',
  },
  'then sort by': {
    insertText: 'then sort by ${1:field} ${2|asc,desc|}',
  },
  'then take': {
    insertText: 'then take ${1:25}',
  },
  'then unwind': {
    insertText: 'then unwind ${1:expression} as ${2:item}',
  },
  'then with': {
    insertText: 'then with ${1:expression} as ${2:name}',
  },
  'union all': {
    insertText: 'union all',
  },
} as const;

export type FdqlCoreSnippetName = keyof typeof fdqlCoreSnippetByName;

export const fdqlCoreSnippetNames = recordKeys(fdqlCoreSnippetByName);

export interface FdqlCoreLanguageItem<Name extends string = string>
  extends FdqlProviderLanguageItem
{
  readonly name: Name;
}

export interface FdqlCoreLanguageMetadata {
  readonly expressionFunctions: readonly FdqlCoreLanguageItem<FdqlCoreExpressionFunctionName>[];
  readonly keywords: readonly FdqlCoreKeyword[];
  readonly settings: readonly FdqlCoreLanguageItem<FdqlCoreSettingKey>[];
  readonly snippets: readonly FdqlCoreLanguageItem<FdqlCoreSnippetName>[];
}

export const fdqlCoreLanguageMetadata = {
  expressionFunctions: languageItems(fdqlCoreExpressionFunctionByName),
  keywords: fdqlCoreKeywords,
  settings: languageItems(fdqlCoreSettingByName),
  snippets: languageItems(fdqlCoreSnippetByName),
} as const satisfies FdqlCoreLanguageMetadata;

type LanguageItemInput = Omit<FdqlProviderLanguageItem, 'name'>;

function languageItems<const Items extends Record<string, LanguageItemInput>>(
  items: Items,
): {
  readonly [Name in keyof Items & string]: FdqlCoreLanguageItem<Name>;
}[keyof Items & string][] {
  return Object.entries(items).map(([name, item]) => ({
    ...item,
    name,
  })) as {
    readonly [Name in keyof Items & string]: FdqlCoreLanguageItem<Name>;
  }[keyof Items & string][];
}

function recordKeys<const Items extends Record<string, unknown>>(
  items: Items,
): (keyof Items & string)[] {
  return Object.keys(items) as (keyof Items & string)[];
}
