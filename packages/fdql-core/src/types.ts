import type { FdqlDefaultProviderContext, FdqlProviderDialect } from './provider.ts';
export type { FdqlValue } from './value.ts';
import type { FdqlValue } from './value.ts';

export interface FdqlDiagnostic {
  readonly code: string;
  readonly column?: number | undefined;
  readonly context?: FdqlDiagnosticContext | undefined;
  readonly line?: number | undefined;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface FdqlDiagnosticContext {
  readonly provider?: string | undefined;
  readonly rowAlias?: string | undefined;
  readonly rowPath?: string | undefined;
  readonly source?: string | undefined;
  readonly stage?: string | undefined;
}

export interface FdqlSourceRange {
  readonly endColumn: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly startLine: number;
}

export type FdqlLiteralValue = boolean | null | number | string;

export type FdqlExpression =
  | FdqlAliasExpression
  | FdqlArrayExpression
  | FdqlBinaryExpression
  | FdqlCallExpression
  | FdqlFieldExpression
  | FdqlLiteralExpression
  | FdqlMapExpression
  | FdqlUnaryExpression
  | FdqlWildcardExpression;

export interface FdqlLiteralExpression {
  readonly kind: 'literal';
  readonly range?: FdqlSourceRange | undefined;
  readonly value: FdqlLiteralValue;
}

export interface FdqlAliasExpression {
  readonly kind: 'alias';
  readonly name: string;
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlFieldExpression {
  readonly kind: 'field';
  readonly path: readonly string[];
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlArrayExpression {
  readonly items: readonly FdqlExpression[];
  readonly kind: 'array';
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlMapExpression {
  readonly entries: readonly FdqlMapEntry[];
  readonly kind: 'map';
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlMapEntry {
  readonly key: string;
  readonly value: FdqlExpression;
}

export interface FdqlCallExpression {
  readonly args: readonly FdqlExpression[];
  readonly kind: 'call';
  readonly name: string;
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlWildcardExpression {
  readonly kind: 'wildcard';
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlUnaryExpression {
  readonly expression: FdqlExpression;
  readonly kind: 'unary';
  readonly operator: 'not';
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlBinaryExpression {
  readonly kind: 'binary';
  readonly left: FdqlExpression;
  readonly operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'in' | 'or';
  readonly range?: FdqlSourceRange | undefined;
  readonly right: FdqlExpression;
}

export interface FdqlSetDeclaration {
  readonly column: number;
  readonly key: string;
  readonly line: number;
  readonly rawValue: string;
  readonly range: FdqlSourceRange;
  readonly value?: FdqlExpression | undefined;
}

export interface FdqlAliasDeclaration {
  readonly column: number;
  readonly line: number;
  readonly name: string;
  readonly range: FdqlSourceRange;
  readonly value: FdqlExpression;
}

export interface FdqlFromStage {
  readonly column: number;
  readonly kind: 'from';
  readonly line: number;
  readonly range: FdqlSourceRange;
  readonly rowAlias: string;
  readonly sourceAlias: string;
}

export type FdqlStage =
  | FdqlAggregateStage
  | FdqlFilterStage
  | FdqlLimitStage
  | FdqlLookupStage
  | FdqlOrderByStage
  | FdqlReturnStage
  | FdqlSortByStage
  | FdqlTakeStage
  | FdqlUnwindStage
  | FdqlWhereStage
  | FdqlWithStage
  | FdqlUnsupportedStage;

export interface FdqlWhereStage {
  readonly column: number;
  readonly expression: FdqlExpression;
  readonly kind: 'providerWhere';
  readonly line: number;
  readonly provider: string;
  readonly range: FdqlSourceRange;
}

export interface FdqlOrderByStage {
  readonly column: number;
  readonly direction: 'asc' | 'desc';
  readonly expression: FdqlExpression;
  readonly kind: 'providerOrderBy';
  readonly line: number;
  readonly provider: string;
  readonly range: FdqlSourceRange;
}

export interface FdqlLimitStage {
  readonly column: number;
  readonly kind: 'providerLimit';
  readonly line: number;
  readonly provider: string;
  readonly range: FdqlSourceRange;
  readonly value: number;
}

export interface FdqlFilterStage {
  readonly column: number;
  readonly expression: FdqlExpression;
  readonly kind: 'filter';
  readonly line: number;
  readonly range: FdqlSourceRange;
}

export interface FdqlTakeStage {
  readonly column: number;
  readonly kind: 'take';
  readonly line: number;
  readonly range: FdqlSourceRange;
  readonly value: number;
}

export interface FdqlSortByStage {
  readonly column: number;
  readonly direction: 'asc' | 'desc';
  readonly expression: FdqlExpression;
  readonly kind: 'sortBy';
  readonly line: number;
  readonly range: FdqlSourceRange;
}

export interface FdqlAggregateStage {
  readonly column: number;
  readonly groups: readonly FdqlProjectionItem[];
  readonly items: readonly FdqlProjectionItem[];
  readonly kind: 'aggregate';
  readonly line: number;
  readonly range: FdqlSourceRange;
}

export type FdqlLookupMode = 'many' | 'one';
export type FdqlCacheMode = 'off' | 'persistent' | 'run';

export type FdqlLookupClause = FdqlWhereStage | FdqlOrderByStage | FdqlLimitStage;

export interface FdqlLookupStage {
  readonly cache?: FdqlCacheMode | undefined;
  readonly cacheTtlRaw?: string | undefined;
  readonly clauses: readonly FdqlLookupClause[];
  readonly column: number;
  readonly kind: 'lookup';
  readonly line: number;
  readonly mode: FdqlLookupMode;
  readonly range: FdqlSourceRange;
  readonly required: boolean;
  readonly rowAlias: string;
  readonly sourceAlias: string;
}

export interface FdqlUnwindStage {
  readonly column: number;
  readonly expression: FdqlExpression;
  readonly kind: 'unwind';
  readonly line: number;
  readonly range: FdqlSourceRange;
  readonly rowAlias: string;
}

export interface FdqlProjectionItem {
  readonly alias?: string | undefined;
  readonly column?: number | undefined;
  readonly expression: FdqlExpression;
  readonly label: string;
  readonly line?: number | undefined;
  readonly range?: FdqlSourceRange | undefined;
}

export interface FdqlWithStage {
  readonly column: number;
  readonly items: readonly FdqlProjectionItem[];
  readonly kind: 'with';
  readonly line: number;
  readonly range: FdqlSourceRange;
}

export interface FdqlReturnStage {
  readonly column: number;
  readonly items: readonly FdqlProjectionItem[];
  readonly kind: 'return';
  readonly line: number;
  readonly range: FdqlSourceRange;
}

export interface FdqlUnsupportedStage {
  readonly column: number;
  readonly kind: 'unsupported';
  readonly line: number;
  readonly range: FdqlSourceRange;
  readonly text: string;
}

export interface FdqlProgram {
  readonly aliases: readonly FdqlAliasDeclaration[];
  readonly from?: FdqlFromStage | undefined;
  readonly settings: readonly FdqlSetDeclaration[];
  readonly stages: readonly FdqlStage[];
}

export type FdqlAst = FdqlProgram | FdqlUnionProgram;

export interface FdqlUnionProgram {
  readonly branches: readonly FdqlProgram[];
  readonly kind: 'union';
}

export type FdqlParseResult =
  | {
    readonly ast: FdqlAst;
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly ok: true;
  }
  | {
    readonly ast?: FdqlAst | undefined;
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly ok: false;
  };

export interface FdqlExecutionSettings {
  readonly allowUnboundedReads: boolean;
  readonly cache: FdqlCacheMode;
  readonly cacheTtlMs: number;
  readonly pageSize: number;
  readonly readBudget: number;
  readonly timeoutMs: number;
}

export type FdqlReadPlan = FdqlSingleReadPlan | FdqlUnionReadPlan;

export type FdqlPlan = FdqlClearCacheCommandPlan | FdqlReadPlan;

export interface FdqlClearCacheCommandPlan {
  readonly kind: 'clearCache';
  readonly projectId?: string | undefined;
  readonly provider?: string | undefined;
}

export interface FdqlSingleReadPlan {
  readonly aliases: Readonly<Record<string, FdqlValue>>;
  readonly kind: 'read';
  readonly localStages: readonly FdqlLocalPlanStage[];
  readonly provider: FdqlProviderReadPlan;
  readonly returnStage: FdqlReturnStage;
  readonly rowAlias: string;
  readonly settings: FdqlExecutionSettings;
}

export interface FdqlUnionReadPlan {
  readonly branches: readonly FdqlSingleReadPlan[];
  readonly kind: 'union';
  readonly settings: FdqlExecutionSettings;
}

export interface FdqlProviderReadPlan {
  readonly fieldMask?: readonly FdqlFieldMaskField[] | undefined;
  readonly limit?: number | undefined;
  readonly orderBy?: FdqlProviderOrderByClause | undefined;
  readonly predicate?: FdqlExpression | undefined;
  readonly source: FdqlProviderSource;
}

export interface FdqlProviderSource {
  readonly provider: string;
  readonly sourceAlias: string;
  readonly sourceType: string;
  readonly target: Readonly<Record<string, unknown>>;
}

export interface FdqlFieldMaskField {
  readonly segments: readonly string[];
}

export interface FdqlProviderOrderByClause {
  readonly direction: 'asc' | 'desc';
  readonly expression: FdqlExpression;
}

export type FdqlLocalPlanStage =
  | FdqlAggregateStage
  | FdqlFilterStage
  | FdqlLookupPlanStage
  | FdqlSortByStage
  | FdqlTakeStage
  | FdqlUnwindStage
  | FdqlWithStage;

export interface FdqlLookupPlanStage {
  readonly cache?: FdqlCacheMode | undefined;
  readonly cacheTtlMs?: number | undefined;
  readonly column: number;
  readonly kind: 'lookup';
  readonly line: number;
  readonly mode: FdqlLookupMode;
  readonly provider: FdqlProviderReadPlan;
  readonly range: FdqlSourceRange;
  readonly required: boolean;
  readonly rowAlias: string;
  readonly sourceAlias: string;
}

export type FdqlReadCompileResult =
  | {
    readonly ast: FdqlAst;
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly ok: true;
    readonly plan: FdqlReadPlan;
  }
  | {
    readonly ast?: FdqlAst | undefined;
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly ok: false;
    readonly plan?: FdqlReadPlan | undefined;
  };

export type FdqlCompileResult =
  | {
    readonly ast: FdqlAst;
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly ok: true;
    readonly plan: FdqlPlan;
  }
  | {
    readonly ast?: FdqlAst | undefined;
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly ok: false;
    readonly plan?: FdqlPlan | undefined;
  };

export interface FdqlCompileOptions {
  readonly defaultProviderContext?: FdqlDefaultProviderContext | undefined;
  readonly executionDefaults?: Partial<FdqlExecutionSettings> | undefined;
  readonly providers?: readonly FdqlProviderDialect[] | undefined;
}

export interface FdqlProviderRow {
  readonly context: Readonly<Record<string, unknown>>;
  readonly data: Readonly<Record<string, FdqlValue>>;
  readonly id: string;
  readonly path: string;
  readonly provider: string;
  readonly source: FdqlProviderSource;
}

export interface FdqlProviderReadRequest {
  readonly aliases?: Readonly<Record<string, FdqlValue>> | undefined;
  readonly fieldMask?: readonly FdqlFieldMaskField[] | undefined;
  readonly limit?: number | undefined;
  readonly maxDocuments: number;
  readonly orderBy?: FdqlProviderOrderByClause | undefined;
  readonly pageSize: number;
  readonly predicate?: FdqlExpression | undefined;
  readonly rowAlias: string;
  readonly rows?: EvalRows | undefined;
  readonly source: FdqlProviderSource;
  readonly stage: 'lookup' | 'source';
}

export interface FdqlExecutionOptions {
  readonly cacheContext?: Readonly<Record<string, unknown>> | undefined;
  readonly persistentCache?: FdqlPersistentCache | undefined;
  readonly now?: (() => number) | undefined;
  readonly signal?: FdqlAbortSignal | undefined;
}

export interface FdqlAbortSignal {
  readonly aborted: boolean;
  addEventListener?:
    | ((
      type: 'abort',
      listener: () => void,
      options?: { readonly once?: boolean; } | undefined,
    ) => void)
    | undefined;
  removeEventListener?: ((type: 'abort', listener: () => void) => void) | undefined;
}

export interface FdqlProviderReadControls {
  readonly deadlineAtMs: number;
  readonly now: () => number;
  readonly signal?: FdqlAbortSignal | undefined;
}

export type FdqlStopReason = 'budget' | 'cancelled' | 'completed' | 'timeout';

export interface FdqlStats {
  readonly aggregateSourceRows: number;
  readonly cacheBytes: number;
  readonly cacheEvictions: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheWrites: number;
  readonly lookupReads: number;
  readonly providerReads: Readonly<Record<string, number>>;
  readonly readBudget: number;
  readonly reads: number;
  readonly rowsOutput: number;
  readonly rowsScanned: number;
  readonly stoppedReason?: FdqlStopReason | undefined;
  readonly unionBranches: number;
}

export interface FdqlRowLineage {
  readonly provider: string;
  readonly source: string;
  readonly rowPath: string;
  readonly readContribution: number;
}

export type FdqlExecutionEvent =
  | { readonly kind: 'started'; }
  | { readonly diagnostic: FdqlDiagnostic; readonly kind: 'diagnostic'; }
  | {
    readonly count: number;
    readonly kind: 'read';
    readonly provider: string;
    readonly source: string;
  }
  | {
    readonly kind: 'row';
    readonly lineage: FdqlRowLineage;
    readonly row: Record<string, unknown>;
  }
  | { readonly kind: 'stats'; readonly stats: FdqlStats; }
  | { readonly kind: 'completed'; readonly stats: FdqlStats; }
  | { readonly kind: 'cancelled'; readonly stats: FdqlStats; }
  | { readonly diagnostic: FdqlDiagnostic; readonly kind: 'failed'; };

export type EvalRows = Readonly<
  Record<string, FdqlProviderRow | FdqlValue | Record<string, FdqlValue> | null>
>;

export interface FdqlPersistentCache {
  readonly get: (
    request: FdqlPersistentCacheGetRequest,
  ) => Promise<FdqlPersistentCacheHit | null>;
  readonly set: (
    request: FdqlPersistentCacheSetRequest,
  ) => Promise<FdqlPersistentCacheSetResult>;
  readonly clear?:
    | (
      (request: FdqlPersistentCacheClearRequest) => Promise<FdqlPersistentCacheClearResult>
    )
    | undefined;
}

export interface FdqlPersistentCacheKey {
  readonly canonicalJson: string;
  readonly key: unknown;
}

export interface FdqlPersistentCacheGetRequest {
  readonly key: FdqlPersistentCacheKey;
  readonly nowMs: number;
}

export interface FdqlPersistentCacheHit {
  readonly rows: readonly FdqlProviderRow[];
  readonly sizeBytes: number;
}

export interface FdqlPersistentCacheSetRequest {
  readonly expiresAtMs: number;
  readonly key: FdqlPersistentCacheKey;
  readonly nowMs: number;
  readonly rows: readonly FdqlProviderRow[];
}

export interface FdqlPersistentCacheSetResult {
  readonly evictedEntries: number;
  readonly sizeBytes: number;
}

export interface FdqlPersistentCacheClearRequest {
  readonly profile?: string | undefined;
  readonly projectId?: string | undefined;
  readonly provider?: string | undefined;
}

export interface FdqlPersistentCacheClearResult {
  readonly clearedEntries: number;
}
