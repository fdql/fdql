import type {
  EvalRows,
  FdqlAliasDeclaration,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlFieldMaskField,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlProviderSource,
  FdqlValue,
} from './types.ts';

export interface FdqlProviderSourceAlias {
  readonly fieldMask?: readonly FdqlFieldMaskField[] | undefined;
  readonly kind: 'source';
  readonly source: FdqlProviderSource;
}

export interface FdqlProviderSourceResolveInput {
  readonly aliases: Readonly<Record<string, FdqlResolvedAliasValue>>;
  readonly declaration: FdqlAliasDeclaration;
  readonly defaultProviderContext: FdqlDefaultProviderContext;
  readonly diagnostics: FdqlDiagnostic[];
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

export interface FdqlProviderSettingResolveInput {
  readonly diagnostics: FdqlDiagnostic[];
  readonly key: string;
  readonly line: number;
  readonly value: FdqlValue;
}

export type FdqlProviderSettingResolution = Readonly<Record<string, unknown>>;

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

export interface FdqlProviderDialect {
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
  resolveSetting?:
    | ((input: FdqlProviderSettingResolveInput) => FdqlProviderSettingResolution | null)
    | undefined;
  validateOrderBy: (input: FdqlProviderOrderByValidationInput) => void;
  validateWhere: (input: FdqlProviderPredicateValidationInput) => void;
}

export type FdqlProviderDialectRegistry = Readonly<Record<string, FdqlProviderDialect>>;

export interface FdqlProviderRuntime {
  readonly read: (request: FdqlProviderReadRequest) => AsyncIterable<FdqlProviderRow>;
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
