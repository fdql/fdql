import { describe, expect, it } from 'vitest';
import { createFdqlLanguageService, FDQL_LANGUAGE_ID } from './index.ts';

describe('FDQL language service', () => {
  it('exposes reusable language metadata for core and Firestore syntax', () => {
    const service = createFdqlLanguageService();

    expect(FDQL_LANGUAGE_ID).toBe('fdql');
    expect(service.metadata.keywords).toContain('return');
    expect(labels(service.metadata.settings)).toEqual(
      expect.arrayContaining(['fdql.readBudget', 'fs.projectId']),
    );
    expect(labels(service.metadata.sourceFunctions)).toEqual(
      expect.arrayContaining(['fs.collection', 'fs.collectionGroup']),
    );
    expect(labels(service.metadata.providerClauses)).toEqual(
      expect.arrayContaining(['fs where', 'fs order by', 'fs limit']),
    );
    expect(labels(service.metadata.expressionFunctions)).toEqual(
      expect.arrayContaining(['timestamp', 'fs.id']),
    );
  });

  it('returns authoring completions for preamble, source, provider, local, and return contexts', () => {
    const service = createFdqlLanguageService();

    expect(completionLabels(service, 'set ', 1, 5)).toEqual(
      expect.arrayContaining(['fdql.readBudget', 'fs.projectId']),
    );
    expect(completionLabels(service, 'alias $orders = ', 1, 17)).toEqual(
      expect.arrayContaining(['fs.collection', 'fs.collectionGroup']),
    );
    expect(completionLabels(service, 'then ', 1, 6)).toEqual(
      expect.arrayContaining(['then filter', 'then lookup one', 'fs where']),
    );
    expect(completionLabels(service, 'return ', 1, 8)).toEqual(
      expect.arrayContaining(['timestamp', 'entries', 'fs.id']),
    );
  });

  it('returns source-located diagnostics from FDQL compilation', () => {
    const service = createFdqlLanguageService();

    const diagnostics = service.getDiagnostics(`set readBudget = 5000
set fs.projectId = "local"

alias $orders = fs.collection("orders")
from $orders as o
fs limit 1
return fs.id(o) as id`);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'FDQL_INVALID_SET_KEY',
        column: 1,
        endColumn: 2,
        endLine: 1,
        line: 1,
        severity: 'error',
      }),
    ]);
  });

  it('accepts a valid FDQL read sample without diagnostics', () => {
    const service = createFdqlLanguageService();

    const diagnostics = service.getDiagnostics(`set fdql.readBudget = 5000
set fs.projectId = "local"

alias $orders = fs.collection("orders", ["status", "total"])
from $orders as o
fs where o.status = "paid"
fs order by o.total desc
fs limit 25
return fs.id(o) as id, o.status, o.total`);

    expect(diagnostics).toEqual([]);
  });
});

function completionLabels(
  service: ReturnType<typeof createFdqlLanguageService>,
  source: string,
  line: number,
  column: number,
): readonly string[] {
  return labels(service.getCompletions({ column, line, source }));
}

function labels(items: readonly { readonly label: string; }[]): readonly string[] {
  return items.map((item) => item.label);
}
