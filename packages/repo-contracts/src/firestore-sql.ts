export interface FirestoreSqlDiagnostic {
  readonly code: string;
  readonly column?: number | undefined;
  readonly line?: number | undefined;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface FirestoreSqlStats {
  readonly joinMisses: number;
  readonly projectReads: Readonly<Record<string, number>>;
  readonly readBudget: number;
  readonly reads: number;
  readonly rowsOutput: number;
  readonly rowsScanned: number;
  readonly stoppedReason?: 'budget' | 'cancelled' | 'completed' | 'timeout' | undefined;
  readonly writes: number;
}

export interface FirestoreSqlRowLineage {
  readonly baseSource?: string | undefined;
  readonly joinedSources: readonly string[];
  readonly localSources: readonly string[];
  readonly readContribution: number;
  readonly unionBranch?: number | undefined;
}

export interface FirestoreSqlExecutionDefaults {
  readonly pageSize?: number | undefined;
  readonly readBudget?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface FirestoreSqlContext {
  readonly defaultProjectId?: string | undefined;
  readonly projectAliases?: Readonly<Record<string, string>> | undefined;
}

export interface FirestoreSqlCompileRequest {
  readonly connectionId: string;
  readonly context?: FirestoreSqlContext | undefined;
  readonly execution?: FirestoreSqlExecutionDefaults | undefined;
  readonly source: string;
}

export interface FirestoreSqlCompileResult {
  readonly diagnostics: readonly FirestoreSqlDiagnostic[];
  readonly ok: boolean;
  readonly plan?: unknown | undefined;
  readonly snippet?: string | undefined;
}

export interface FirestoreSqlRunRequest extends FirestoreSqlCompileRequest {
  readonly runId: string;
}

export interface FirestoreSqlRunResult {
  readonly cancelled?: boolean | undefined;
  readonly diagnostics: readonly FirestoreSqlDiagnostic[];
  readonly durationMs: number;
  readonly rows: readonly Record<string, unknown>[];
  readonly stats: FirestoreSqlStats | null;
}

export type FirestoreSqlRunEvent =
  | { readonly type: 'started'; readonly runId: string; }
  | { readonly type: 'plan'; readonly plan: unknown; readonly runId: string; }
  | {
    readonly diagnostic: FirestoreSqlDiagnostic;
    readonly runId: string;
    readonly type: 'diagnostic';
  }
  | {
    readonly collectionGroup?: string;
    readonly collectionPath?: string;
    readonly count: number;
    readonly projectId: string;
    readonly runId: string;
    readonly type: 'read';
  }
  | {
    readonly lineage: FirestoreSqlRowLineage;
    readonly row: Record<string, unknown>;
    readonly runId: string;
    readonly type: 'row';
  }
  | { readonly runId: string; readonly stats: FirestoreSqlStats; readonly type: 'stats'; }
  | { readonly result: FirestoreSqlRunResult; readonly runId: string; readonly type: 'completed'; }
  | { readonly result: FirestoreSqlRunResult; readonly runId: string; readonly type: 'cancelled'; }
  | {
    readonly diagnostic: FirestoreSqlDiagnostic;
    readonly result: FirestoreSqlRunResult;
    readonly runId: string;
    readonly type: 'failed';
  };

export type FirestoreSqlRunEventListener = (event: FirestoreSqlRunEvent) => void;

export interface FirestoreSqlRepository {
  compile(request: FirestoreSqlCompileRequest): Promise<FirestoreSqlCompileResult>;
  run(request: FirestoreSqlRunRequest): Promise<FirestoreSqlRunResult>;
  cancel(runId: string): Promise<void>;
  subscribe(listener: FirestoreSqlRunEventListener): () => void;
}
