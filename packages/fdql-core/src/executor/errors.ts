import type {
  FdqlDiagnostic,
  FdqlDiagnosticContext,
  FdqlProviderAggregateRequest,
  FdqlProviderReadRequest,
  FdqlProviderRow,
} from '../types.ts';

export function diagnosticFromError(error: unknown): FdqlDiagnostic {
  const location: { readonly column?: unknown; readonly line?: unknown; } = error instanceof Error
    ? error as Error & { readonly column?: unknown; readonly line?: unknown; }
    : {};
  const context = error instanceof Error
    ? (error as Error & { readonly context?: unknown; }).context
    : undefined;
  return {
    code: 'FDQL_EXECUTION_FAILED',
    ...(typeof location.column === 'number' ? { column: location.column } : {}),
    ...(isDiagnosticContext(context) ? { context } : {}),
    ...(typeof location.line === 'number' ? { line: location.line } : {}),
    message: error instanceof Error ? error.message : String(error),
    severity: 'error',
  };
}

export function errorWithDiagnosticContext(
  error: unknown,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): Error {
  const next = error instanceof Error ? error : new Error(String(error));
  const existing = (next as Error & { context?: FdqlDiagnosticContext; }).context;
  (next as Error & { context: FdqlDiagnosticContext; }).context = {
    provider: request.source.provider,
    rowAlias: request.rowAlias,
    ...(correlatedRowPath(request) ? { rowPath: correlatedRowPath(request) } : {}),
    source: request.source.sourceAlias,
    stage: request.stage,
    ...(isDiagnosticContext(existing) ? existing : {}),
  };
  return next;
}

function correlatedRowPath(
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): string | undefined {
  if (!request.rows) return undefined;
  for (const value of Object.values(request.rows)) {
    if (isDocument(value)) return value.path;
  }
  return undefined;
}

function isDiagnosticContext(value: unknown): value is FdqlDiagnosticContext {
  return value !== null && typeof value === 'object'
    && Object.entries(value as Record<string, unknown>).every(([key, entry]) =>
      ['provider', 'rowAlias', 'rowPath', 'source', 'stage'].includes(key)
      && (entry === undefined || typeof entry === 'string')
    );
}

function isDocument(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'data' in value
    && 'id' in value
    && 'provider' in value;
}
