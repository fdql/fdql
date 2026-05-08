import { fdqlCoreLanguageMetadata } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { createFdqlLanguageService, FDQL_LANGUAGE_ID } from './index.ts';

describe('FDQL language service', () => {
  it('exposes reusable language metadata for core and Firestore syntax', () => {
    const service = createFdqlLanguageService();

    expect(FDQL_LANGUAGE_ID).toBe('fdql');
    expect(service.metadata.keywords).toContain('return');
    expect(service.metadata.keywords).toContain('clear');
    expect(labels(service.metadata.settings)).toEqual(
      expect.arrayContaining(['fdql.readBudget', 'fs.projectId']),
    );
    expect(labels(service.metadata.sourceFunctions)).toEqual(
      expect.arrayContaining(['fs.collection', 'fs.collectionGroup', 'fs.subcollection']),
    );
    expect(labels(service.metadata.providerClauses)).toEqual(
      expect.arrayContaining(['fs where', 'fs order by', 'fs limit']),
    );
    expect(labels(service.metadata.expressionFunctions)).toEqual(
      expect.arrayContaining(['timestamp', 'fs.id', 'fs.fieldPath']),
    );
    expect(labels(service.metadata.aggregateFunctions)).toEqual(
      expect.arrayContaining(['fs.count', 'fs.sum', 'fs.avg', 'fs.min', 'fs.max']),
    );
    expect(labels(service.metadata.snippets)).toEqual(
      expect.arrayContaining(['clear cache', 'clear cache provider project']),
    );
  });

  it('composes core metadata from fdql-core', () => {
    const service = createFdqlLanguageService();

    expect(labels(service.metadata.settings)).toEqual(
      expect.arrayContaining(names(fdqlCoreLanguageMetadata.settings)),
    );
    expect(labels(service.metadata.expressionFunctions)).toEqual(
      expect.arrayContaining(names(fdqlCoreLanguageMetadata.expressionFunctions)),
    );
    expect(labels(service.metadata.snippets)).toEqual(
      expect.arrayContaining(names(fdqlCoreLanguageMetadata.snippets)),
    );
    expect(service.metadata.keywords).toEqual(
      expect.arrayContaining([...fdqlCoreLanguageMetadata.keywords]),
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
      expect.arrayContaining([
        'filter',
        'lookup one',
        'lookup required one',
        'then provider aggregate',
        'where',
      ]),
    );
    expect(completionLabels(service, 'return ', 1, 8)).toEqual(
      expect.arrayContaining(['timestamp', 'entries', 'fs.id', 'fs.fieldPath']),
    );
    expect(completionLabels(service, 'from ', 1, 6)).toEqual(
      expect.arrayContaining(['fs.aggregate']),
    );
    expect(completionLabels(service, 'from fs.', 1, 9)).toEqual(['fs.aggregate']);
  });

  it('suggests provider aggregate functions in provider aggregate yield context', () => {
    const service = createFdqlLanguageService();
    const source = `alias $rounds = fs.collection("rounds")
from $rounds as r
then fs.aggregate $rounds as round
  yield fs.`;

    expect(completionLabelsAtEnd(service, source)).toEqual(
      expect.arrayContaining(['fs.count', 'fs.sum', 'fs.avg', 'fs.min', 'fs.max']),
    );
    expect(completionLabelsAtEnd(service, 'return fs.')).not.toContain('fs.count');
  });

  it('switches provider and local stage completions to expression context', () => {
    const service = createFdqlLanguageService();
    const source = `alias $events = fs.collection("admin-events", ["slug"])
from $events as o
fs order by `;
    const localSource = `alias $events = fs.collection("admin-events", ["slug"])
from $events as o
then filter `;

    expect(completionLabelsAtEnd(service, 'fs ')).toEqual(
      expect.arrayContaining(['where', 'order by', 'limit']),
    );
    expect(completionLabelsAtEnd(service, source)).toEqual(
      expect.arrayContaining(['o', 'timestamp', 'fs.id']),
    );
    expect(completionLabelsAtEnd(service, source)).not.toContain('fs order by');
    expect(completionLabelsAtEnd(service, localSource)).toEqual(
      expect.arrayContaining(['o', 'entries']),
    );
    expect(completionLabelsAtEnd(service, localSource)).not.toContain('then filter');
  });

  it('suggests lookup cache overrides in lookup headers', () => {
    const service = createFdqlLanguageService();
    const source = `alias $teams = fs.collection("teams")
from $teams as t
then lookup one $teams as team `;
    const requiredSource = `alias $teams = fs.collection("teams")
from $teams as t
then lookup required one $teams as team `;
    const cacheSource = `${source}cache `;

    expect(completionLabelsAtEnd(service, source)).toEqual([
      'cache run',
      'cache persistent',
      'cache off',
    ]);
    expect(completionLabelsAtEnd(service, requiredSource)).toEqual([
      'cache run',
      'cache persistent',
      'cache off',
    ]);
    expect(completionLabelsAtEnd(service, cacheSource)).toEqual(['run', 'persistent', 'off']);
  });

  it('suggests reserved cache clear commands', () => {
    const service = createFdqlLanguageService();

    expect(completionLabelsAtEnd(service, 'clear ')).toEqual([
      'cache',
      'cache provider fs',
      'cache provider fs project',
    ]);
  });

  it('uses plain context-aware insert text by default', () => {
    const service = createFdqlLanguageService();

    expect(completionInsertTextsAtEnd(service, 'then ')).toEqual(
      expect.arrayContaining(['filter ', 'lookup one ']),
    );
    expect(completionInsertTextsAtEnd(service, 'then ')).not.toContain('then filter');
    expect(completionInsertTextsAtEnd(service, 'alias $orders = fs.')).toEqual(
      expect.arrayContaining(['fs.collection("collection")']),
    );
    expect(completionInsertTextsAtEnd(service, 'set ')).toEqual(
      expect.arrayContaining(['fdql.readBudget = ']),
    );
  });

  it('suggests source aliases and masked row fields from the current query', () => {
    const service = createFdqlLanguageService();
    const source =
      `alias $events = fs.collection("admin-events", ["name", "slug", "schedule", "entriesById"])
from $events as o
return o.`;

    expect(
      completionLabelsAtEnd(
        service,
        'alias $events = fs.collection("admin-events", ["name"])\nfrom $',
      ),
    ).toEqual(['$events']);
    expect(completionLabelsAtEnd(service, source)).toEqual([
      'name',
      'slug',
      'schedule',
      'entriesById',
    ]);
  });

  it('does not show generic function completions after an expression dot', () => {
    const service = createFdqlLanguageService();
    const source = `alias $events = fs.collection("admin-events", ["entriesById"])
from $events as o
return entries(o.entriesById).`;

    expect(completionLabelsAtEnd(service, source)).toEqual([]);
  });

  it('scopes provider dot completions to source or value functions', () => {
    const service = createFdqlLanguageService();

    expect(completionLabelsAtEnd(service, 'alias $events = fs.')).toEqual(
      expect.arrayContaining(['fs.collection', 'fs.collectionGroup']),
    );
    expect(completionLabelsAtEnd(service, 'alias $events = fs.')).not.toContain('fs.id');
    expect(completionLabelsAtEnd(service, 'return fs.')).toEqual(
      expect.arrayContaining(['fs.id', 'fs.path', 'fs.projectId']),
    );
    expect(completionLabelsAtEnd(service, 'return fs.')).not.toContain('fs.collection');
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

  it('accepts a valid cache clear command without diagnostics', () => {
    const service = createFdqlLanguageService();

    const diagnostics = service.getDiagnostics('clear cache provider fs project "local"');

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

function completionLabelsAtEnd(
  service: ReturnType<typeof createFdqlLanguageService>,
  source: string,
): readonly string[] {
  const lines = source.split(/\r?\n/);
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return completionLabels(service, source, line, column);
}

function completionInsertTextsAtEnd(
  service: ReturnType<typeof createFdqlLanguageService>,
  source: string,
): readonly string[] {
  const lines = source.split(/\r?\n/);
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return service.getCompletions({ column, line, source }).map((item) => item.insertText);
}

function labels(items: readonly { readonly label: string; }[]): string[] {
  return items.map((item) => item.label);
}

function names(items: readonly { readonly name: string; }[]): string[] {
  return items.map((item) => item.name);
}
