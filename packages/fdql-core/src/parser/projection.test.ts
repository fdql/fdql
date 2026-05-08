import { describe, expect, it } from 'vitest';
import type { FdqlDiagnostic } from '../types.ts';
import { collectProjection, parseProjectionItems } from './projection.ts';
import { createSourceLines } from './source-text.ts';

describe('FDQL parser projection', () => {
  it('collects multiline return blocks until the next statement', () => {
    const block = collectProjection(
      createSourceLines(`return
  d.firstName as firstName,
  d.lastName as lastName
then take 1`),
      0,
      'return',
    );

    expect(block).toMatchObject({
      nextIndex: 2,
      source: 'd.firstName as firstName,\nd.lastName as lastName',
      sourceLine: 2,
    });
  });

  it('splits projection items without splitting strings', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const items = parseProjectionItems(
      `'paid, active' as statusLabel, lower(d.name) as nameKey`,
      1,
      8,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(items).toEqual([
      expect.objectContaining({ alias: 'statusLabel' }),
      expect.objectContaining({ alias: 'nameKey' }),
    ]);
  });

  it('parses spread projection items', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const items = parseProjectionItems('...stats, *', 1, 8, diagnostics);

    expect(diagnostics).toEqual([]);
    expect(items).toEqual([
      expect.objectContaining({
        expression: expect.objectContaining({ kind: 'field', path: ['stats'] }),
        label: 'stats',
        spread: true,
      }),
      expect.objectContaining({
        expression: expect.objectContaining({ kind: 'wildcard' }),
        label: '*',
      }),
    ]);
  });

  it('rejects aliases on spread projection items', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    parseProjectionItems('...stats as stats', 1, 8, diagnostics);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_SPREAD_PROJECTION' }),
    );
  });
});
