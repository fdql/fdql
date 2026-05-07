import { describe, expect, it } from 'vitest';
import type { FdqlProviderReadRequest, FdqlProviderRow, FdqlProviderSource } from '../types.ts';
import { stringValue } from '../value.ts';
import { diagnosticFromError, errorWithDiagnosticContext } from './errors.ts';

describe('FDQL executor errors', () => {
  it('converts thrown values into execution diagnostics', () => {
    const error = new Error('Read failed.') as Error & {
      column: number;
      context: { readonly provider: string; readonly source: string; };
      line: number;
    };
    error.column = 9;
    error.context = { provider: 'mem', source: '$items' };
    error.line = 4;

    expect(diagnosticFromError(error)).toEqual({
      code: 'FDQL_EXECUTION_FAILED',
      column: 9,
      context: { provider: 'mem', source: '$items' },
      line: 4,
      message: 'Read failed.',
      severity: 'error',
    });
    expect(diagnosticFromError('boom')).toEqual({
      code: 'FDQL_EXECUTION_FAILED',
      message: 'boom',
      severity: 'error',
    });
  });

  it('adds provider read context to errors', () => {
    const error = errorWithDiagnosticContext(new Error('Lookup failed.'), readRequest());

    expect(diagnosticFromError(error)).toEqual({
      code: 'FDQL_EXECUTION_FAILED',
      context: {
        provider: 'fs',
        rowAlias: 'driver',
        rowPath: 'events/event_1',
        source: '$drivers',
        stage: 'lookup',
      },
      message: 'Lookup failed.',
      severity: 'error',
    });
  });

  it('preserves existing valid diagnostic context', () => {
    const original = new Error('Lookup failed.') as Error & {
      context: { readonly rowPath: string; };
    };
    original.context = { rowPath: 'custom/path' };

    const error = errorWithDiagnosticContext(original, readRequest());

    expect(diagnosticFromError(error).context).toEqual({
      provider: 'fs',
      rowAlias: 'driver',
      rowPath: 'custom/path',
      source: '$drivers',
      stage: 'lookup',
    });
  });
});

function readRequest(): FdqlProviderReadRequest {
  return {
    maxDocuments: 100,
    pageSize: 50,
    rowAlias: 'driver',
    rows: { event: parentRow() },
    source: driversSource(),
    stage: 'lookup',
  };
}

function parentRow(): FdqlProviderRow {
  return {
    context: { projectId: 'local' },
    data: { name: stringValue('Race') },
    id: 'event_1',
    path: 'events/event_1',
    provider: 'fs',
    source: eventsSource(),
  };
}

function driversSource(): FdqlProviderSource {
  return {
    provider: 'fs',
    sourceAlias: '$drivers',
    sourceType: 'collection',
    target: { collectionPath: 'drivers', projectId: 'local' },
  };
}

function eventsSource(): FdqlProviderSource {
  return {
    provider: 'fs',
    sourceAlias: '$events',
    sourceType: 'collection',
    target: { collectionPath: 'events', projectId: 'local' },
  };
}
