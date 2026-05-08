import type {
  EvalRows,
  FdqlAliasDeclaration,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlFieldMaskField,
  FdqlProviderAggregateRequest,
  FdqlProviderAggregateResult,
  FdqlProviderOrderByClause,
  FdqlProviderReadControls,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlProviderSource,
  FdqlProviderSourceBinding,
  FdqlValue,
} from './types.ts';

export interface FdqlProviderSourceAlias {
  readonly binding?: FdqlProviderSourceBinding | undefined;
  readonly fieldMask?: readonly FdqlFieldMaskField[] | undefined;
  readonly kind: 'source';
  readonly source: FdqlProviderSource;
}

export interface FdqlProviderSourceResolveInput {
  readonly aliases: Readonly<Record<string, FdqlResolvedAliasValue>>;
  readonly availableRowAliases?: ReadonlySet<string> | undefined;
  readonly declaration: FdqlAliasDeclaration;
  readonly defaultProviderContext: FdqlDefaultProviderContext;
  readonly diagnostics: FdqlDiagnostic[];
}

export interface FdqlProviderSourceExpressionResolveInput {
  readonly aliases: Readonly<Record<string, FdqlResolvedAliasValue>>;
  readonly availableRowAliases: ReadonlySet<string>;
  readonly defaultProviderContext: FdqlDefaultProviderContext;
  readonly diagnostics: FdqlDiagnostic[];
  readonly expression: FdqlExpression;
  readonly line: number;
  readonly sourceAlias: string;
}

export type FdqlDefaultProviderContext = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

export type FdqlResolvedAliasValue = FdqlProviderSourceAlias | {
  readonly kind: 'value';
  readonly value: FdqlValue;
};

export interface FdqlProviderPredicateValidationInput {
  readonly aliases: Readonly<Record<string, FdqlValue>>;
  readonly availableRowAliases: ReadonlySet<string>;
  readonly diagnostics: FdqlDiagnostic[];
  readonly expression: FdqlExpression;
  readonly line: number;
  readonly lookup: boolean;
  readonly rowAlias: string;
}

export interface FdqlProviderOrderByValidationInput {
  readonly diagnostics: FdqlDiagnostic[];
  readonly expression: FdqlExpression;
  readonly line: number;
  readonly rowAlias: string;
}

export interface FdqlProviderQueryValidationInput {
  readonly aliases: Readonly<Record<string, FdqlValue>>;
  readonly availableRowAliases: ReadonlySet<string>;
  readonly diagnostics: FdqlDiagnostic[];
  readonly lookup: boolean;
  readonly orderBy?: FdqlProviderOrderByClause | undefined;
  readonly orderByLine?: number | undefined;
  readonly predicate?: FdqlExpression | undefined;
  readonly predicateLine?: number | undefined;
  readonly rowAlias: string;
}

export interface FdqlProviderSettingResolveInput {
  readonly diagnostics: FdqlDiagnostic[];
  readonly key: string;
  readonly line: number;
  readonly value: FdqlValue;
}

export type FdqlProviderSettingResolution = Readonly<Record<string, unknown>>;

export interface FdqlProviderLanguageItem {
  readonly detail?: string | undefined;
  readonly documentation?: string | undefined;
  readonly insertText?: string | undefined;
  readonly label?: string | undefined;
  readonly name: string;
}

export interface FdqlProviderLanguageClause {
  readonly detail?: string | undefined;
  readonly documentation?: string | undefined;
  readonly insertText?: string | undefined;
  readonly keyword: string;
  readonly label?: string | undefined;
}

export interface FdqlProviderLanguageMetadata {
  readonly aggregateFunctions?: readonly FdqlProviderLanguageItem[] | undefined;
  readonly clauses?: readonly FdqlProviderLanguageClause[] | undefined;
  readonly settings?: readonly FdqlProviderLanguageItem[] | undefined;
  readonly sourceFunctions?: readonly FdqlProviderLanguageItem[] | undefined;
  readonly valueFunctions?: readonly FdqlProviderLanguageItem[] | undefined;
}

export interface FdqlProviderCallEvaluationInput {
  readonly args: readonly FdqlExpression[];
  readonly context: FdqlProviderEvaluationContext;
  readonly evaluate: (
    expression: FdqlExpression,
    context: FdqlProviderEvaluationContext,
  ) => FdqlValue;
  readonly name: string;
}

export interface FdqlProviderEvaluationContext {
  readonly aliases?: Readonly<Record<string, FdqlValue>> | undefined;
  readonly providers?: FdqlProviderDialectRegistry | undefined;
  readonly rows?: EvalRows | undefined;
}

export interface FdqlProviderSourceBindInput {
  readonly binding: FdqlProviderSourceBinding;
  readonly context: FdqlProviderEvaluationContext;
  readonly line: number;
  readonly source: FdqlProviderSource;
}

export type FdqlProviderSourceBindResult =
  | { readonly kind: 'bound'; readonly source: FdqlProviderSource; }
  | { readonly kind: 'failed'; readonly diagnostic: FdqlDiagnostic; }
  | { readonly kind: 'skip'; };

export interface FdqlProviderDialect {
  readonly aggregateFunctions?: ReadonlySet<string> | undefined;
  readonly cacheVersion?: number | string | undefined;
  readonly language?: FdqlProviderLanguageMetadata | undefined;
  readonly namespace: string;
  readonly sourceFunctions: ReadonlySet<string>;
  readonly valueFunctions: ReadonlySet<string>;
  evaluateCall?: ((input: FdqlProviderCallEvaluationInput) => FdqlValue) | undefined;
  hasBoundedPredicate?:
    | ((
      expression: FdqlExpression | undefined,
      rowAlias: string,
    ) => boolean)
    | undefined;
  resolveSourceAlias: (
    input: FdqlProviderSourceResolveInput,
  ) => FdqlProviderSourceAlias | null;
  bindSource?:
    | ((input: FdqlProviderSourceBindInput) => FdqlProviderSourceBindResult)
    | undefined;
  resolveSourceExpression?:
    | ((input: FdqlProviderSourceExpressionResolveInput) => FdqlProviderSourceAlias | null)
    | undefined;
  resolveSetting?:
    | ((input: FdqlProviderSettingResolveInput) => FdqlProviderSettingResolution | null)
    | undefined;
  validateOrderBy: (input: FdqlProviderOrderByValidationInput) => void;
  validateWhere: (input: FdqlProviderPredicateValidationInput) => void;
  validateAggregate?:
    | ((input: FdqlProviderAggregateValidationInput) => void)
    | undefined;
  validateQuery?: ((input: FdqlProviderQueryValidationInput) => void) | undefined;
}

export type FdqlProviderDialectRegistry = Readonly<Record<string, FdqlProviderDialect>>;

export interface FdqlProviderAggregateValidationInput {
  readonly diagnostics: FdqlDiagnostic[];
  readonly expression: FdqlExpression;
  readonly functionName: string;
  readonly line: number;
  readonly rowAlias: string;
}

export interface FdqlProviderRuntime {
  readonly aggregate?:
    | ((
      request: FdqlProviderAggregateRequest,
      controls: FdqlProviderReadControls,
    ) => Promise<FdqlProviderAggregateResult>)
    | undefined;
  readonly read: (
    request: FdqlProviderReadRequest,
    controls: FdqlProviderReadControls,
  ) => AsyncIterable<FdqlProviderRow>;
}

export interface FdqlProviderRuntimeRegistry {
  readonly dialects?: FdqlProviderDialectRegistry | undefined;
  readonly providers: Readonly<Record<string, FdqlProviderRuntime>>;
}

export function createProviderDialectRegistry(
  providers: readonly FdqlProviderDialect[],
): FdqlProviderDialectRegistry {
  return Object.fromEntries(providers.map((provider) => [provider.namespace, provider]));
}

export function providerNamespaceFromCall(name: string): string | null {
  const separator = name.indexOf('.');
  return separator > 0 ? name.slice(0, separator) : null;
}

export function providerKey(provider: string, context: string | undefined): string {
  return context ? `${provider}:${context}` : provider;
}

export function providerContextValue(row: FdqlProviderRow, key: string): unknown {
  return row.context[key];
}
