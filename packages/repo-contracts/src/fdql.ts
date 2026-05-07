export interface FdqlDiagnostic {
  readonly code: string;
  readonly column?: number | undefined;
  readonly line?: number | undefined;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

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
  readonly stoppedReason?: 'budget' | 'cancelled' | 'completed' | 'timeout' | undefined;
  readonly unionBranches: number;
}

export interface FdqlRowLineage {
  readonly provider: string;
  readonly readContribution: number;
  readonly rowPath: string;
  readonly source: string;
}

export interface FdqlExecutionDefaults {
  readonly allowUnboundedReads?: boolean | undefined;
  readonly cache?: 'off' | 'persistent' | 'run' | undefined;
  readonly cacheTtlMs?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly readBudget?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface FdqlCompileRequest {
  readonly connectionId: string;
  readonly defaultProjectId?: string | undefined;
  readonly execution?: FdqlExecutionDefaults | undefined;
  readonly source: string;
}

export interface FdqlCompileResult {
  readonly diagnostics: readonly FdqlDiagnostic[];
  readonly ok: boolean;
}

export interface FdqlRunRequest extends FdqlCompileRequest {
  readonly runId: string;
}

export interface FdqlRunResult {
  readonly cancelled?: boolean | undefined;
  readonly diagnostics: readonly FdqlDiagnostic[];
  readonly durationMs: number;
  readonly rows: readonly Record<string, unknown>[];
  readonly stats: FdqlStats | null;
}

export type FdqlRunEvent =
  | { readonly runId: string; readonly type: 'started'; }
  | { readonly diagnostic: FdqlDiagnostic; readonly runId: string; readonly type: 'diagnostic'; }
  | {
    readonly count: number;
    readonly provider: string;
    readonly runId: string;
    readonly source: string;
    readonly type: 'read';
  }
  | {
    readonly lineage: FdqlRowLineage;
    readonly row: Record<string, unknown>;
    readonly runId: string;
    readonly type: 'row';
  }
  | { readonly runId: string; readonly stats: FdqlStats; readonly type: 'stats'; }
  | { readonly result: FdqlRunResult; readonly runId: string; readonly type: 'completed'; }
  | { readonly result: FdqlRunResult; readonly runId: string; readonly type: 'cancelled'; }
  | {
    readonly diagnostic: FdqlDiagnostic;
    readonly result: FdqlRunResult;
    readonly runId: string;
    readonly type: 'failed';
  };

export type FdqlRunEventListener = (event: FdqlRunEvent) => void;

export interface FdqlRepository {
  compile(request: FdqlCompileRequest): Promise<FdqlCompileResult>;
  run(request: FdqlRunRequest): Promise<FdqlRunResult>;
  cancel(runId: string): Promise<void>;
  subscribe(listener: FdqlRunEventListener): () => void;
}
