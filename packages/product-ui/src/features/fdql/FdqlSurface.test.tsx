import { FDQL_LANGUAGE_ID } from '@firebase-desk/fdql-language';
import type { FdqlRunResult } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FdqlSurface } from './FdqlSurface.tsx';

const codeEditorProbe = vi.hoisted(() => ({
  revealTargets: [] as unknown[],
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (
    { count, estimateSize }: {
      readonly count: number;
      readonly estimateSize: (index: number) => number;
    },
  ) => {
    const size = count > 0 ? estimateSize(0) : 0;
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          size,
          start: index * size,
        })),
    };
  },
}));

vi.mock('../../code-editor/CodeEditor.tsx', () => ({
  CodeEditor: (
    { language, onChange, readOnly, revealCursorTarget, value }: {
      readonly language: string;
      readonly onChange?: (value: string) => void;
      readonly readOnly?: boolean;
      readonly revealCursorTarget?: unknown;
      readonly value: string;
    },
  ) => {
    if (revealCursorTarget) codeEditorProbe.revealTargets.push(revealCursorTarget);
    return (
      <textarea
        aria-label='FDQL source'
        data-language={language}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange?.(event.currentTarget.value)}
      />
    );
  },
}));

const startsAtIso = '2026-05-05T10:27:00.000Z';

const result: FdqlRunResult = {
  diagnostics: [],
  durationMs: 1_234,
  rowLineages: [{
    bindings: [{
      binding: 'version',
      sources: [{
        provider: 'fs',
        readContribution: 1,
        rowPath: 'public-versions/current',
        source: '$versions',
        stage: 'source',
      }],
    }],
    mode: 'compact',
    readContribution: 1,
    sources: [{
      provider: 'fs',
      readContribution: 1,
      rowPath: 'public-versions/current',
      source: '$versions',
      stage: 'source',
    }],
  }],
  rows: [{
    id: 'version',
    metadata: { channel: 'stable' },
    startsAt: { __fdqlType: 'timestamp', value: startsAtIso },
    version: 3166,
  }],
  stats: {
    aggregateReads: 0,
    aggregateSourceRows: 0,
    cacheBytes: 0,
    cacheEvictions: 0,
    cacheHits: 1,
    cacheMisses: 2,
    cacheWrites: 0,
    lookupReads: 0,
    providerAggregateReads: {},
    providerReads: { 'fs:local': 1 },
    readBudget: 5000,
    reads: 1,
    rowsOutput: 1,
    rowsScanned: 1,
    stageStats: [{
      aggregateReads: 0,
      durationMs: 42,
      droppedRows: 0,
      endedAtMs: 142,
      inputRows: 0,
      outputRows: 1,
      provider: 'fs',
      reads: 1,
      source: '$versions',
      stage: 'source',
      startedAtMs: 100,
    }],
    stoppedReason: 'completed',
    unionBranches: 0,
  },
};

describe('FdqlSurface', () => {
  beforeEach(() => {
    codeEditorProbe.revealTargets = [];
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      })),
    );
  });

  it('shows lineage for the selected row', () => {
    const onOpenDocumentInNewTab = vi.fn();
    render(
      <FdqlSurface
        result={result}
        source='return version'
        onCancel={() => undefined}
        onOpenDocumentInNewTab={onOpenDocumentInNewTab}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Lineage/ }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText('source · $versions')).toBeTruthy();
    expect(screen.getByText('0 in · 1 out · 0 dropped · 42ms · 1 reads')).toBeTruthy();
    expect(screen.getByText('slowest')).toBeTruthy();
    expect(screen.getByText('fs · $versions')).toBeTruthy();
    expect(screen.getByText('public-versions/current')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Open/ }));

    expect(onOpenDocumentInNewTab).toHaveBeenCalledWith('public-versions/current');
  });

  it('shows lineage disabled state when row lineage is omitted', () => {
    render(
      <FdqlSurface
        result={{ ...result, rowLineages: undefined }}
        source='set fdql.lineage = off'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Lineage/ }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText('Lineage disabled for this run.')).toBeTruthy();
  });

  it('shows table, tree, lazy JSON, and execution time for results', async () => {
    render(
      <FdqlSurface
        result={result}
        source='return version'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    expect(screen.getByText('1.234s elapsed')).toHaveProperty('title', '1234ms');
    expect(screen.getByText('1 cache hit')).toBeTruthy();
    expect(screen.getByText('2 cache misses')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'version' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '3166' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: expectedLocalTimestamp(startsAtIso) })).toHaveProperty(
      'title',
      startsAtIso,
    );
    expect(screen.queryByText('time')).toBeNull();
    expect(screen.queryByText(/__fdqlType/)).toBeNull();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Tree/ }), {
      button: 0,
      ctrlKey: false,
    });
    const tree = screen.getByRole('tree');
    expect(tree).toBeTruthy();
    expect(screen.getByText('row_1')).toBeTruthy();
    expect(within(tree).getByText(expectedLocalTimestamp(startsAtIso))).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /JSON/ }), {
      button: 0,
      ctrlKey: false,
    });
    const json = await screen.findByLabelText('FDQL JSON results');
    expect(json).toHaveProperty('value', expect.stringContaining('"version": 3166'));
    expect(json).toHaveProperty('value', expect.stringContaining('"__fdqlType": "timestamp"'));
  });

  it('preserves tree expansion while rows stream for the same run', () => {
    const { rerender } = render(
      <FdqlSurface
        result={result}
        runId='run-1'
        source='return version'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Tree/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('treeitem', { name: /metadata/ }));
    expect(within(screen.getByRole('tree')).getByText('channel')).toBeTruthy();

    rerender(
      <FdqlSurface
        result={{
          ...result,
          rows: [
            ...result.rows,
            { id: 'next', metadata: { channel: 'beta' }, version: 3167 },
          ],
        }}
        runId='run-1'
        source='return version'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    expect(within(screen.getByRole('tree')).getByText('channel')).toBeTruthy();

    rerender(
      <FdqlSurface
        result={result}
        runId='run-2'
        source='return version'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    expect(within(screen.getByRole('tree')).queryByText('channel')).toBeNull();
  });

  it('uses the FDQL editor language', () => {
    render(
      <FdqlSurface
        source='return *'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText('FDQL source').getAttribute('data-language')).toBe(
      FDQL_LANGUAGE_ID,
    );
  });

  it('shows cache clear command completion without stale rows', () => {
    render(
      <FdqlSurface
        result={{
          command: {
            clearedEntries: 12,
            kind: 'clearCache',
            message: 'Cleared 12 cache entries.',
          },
          diagnostics: [],
          durationMs: 42,
          rows: [],
          stats: null,
        }}
        source='clear cache'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    expect(screen.getByText('Cache cleared')).toBeTruthy();
    expect(screen.getByText('Cleared 12 cache entries.')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'version' })).toBeNull();
  });

  it('shows selectable issue messages', () => {
    render(
      <FdqlSurface
        result={{
          diagnostics: [{
            column: 18,
            code: 'FDQL_EXECUTION_FAILED',
            context: {
              provider: 'fs',
              rowAlias: 'driver',
              rowPath: 'events/event_24h',
              source: '$drivers',
              stage: 'lookup',
            },
            line: 9,
            message: 'Firestore filter value resolved to missing for eDriver.steamId.',
            severity: 'error',
          }],
          durationMs: 15,
          rows: [],
          stats: null,
        }}
        source='return *'
        onCancel={() => undefined}
        onRun={() => undefined}
        onSourceChange={() => undefined}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Issues/ }), {
      button: 0,
      ctrlKey: false,
    });

    const message = screen.getByText(
      'Firestore filter value resolved to missing for eDriver.steamId.',
    );
    const location = screen.getByRole('button', { name: 'Line 9, column 18' });
    expect(location).toBeTruthy();
    expect(
      screen.getByText(
        'provider fs · source $drivers · stage lookup · row driver · path events/event_24h',
      ),
    ).toBeTruthy();
    expect(message.closest('.select-text')).toBeTruthy();

    fireEvent.click(location);

    expect(codeEditorProbe.revealTargets.at(-1)).toMatchObject({
      column: 18,
      line: 9,
    });
  });
});

function expectedLocalTimestamp(iso: string): string {
  const date = new Date(iso);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `${sign}${pad2(Math.floor(absoluteMinutes / 60))}:${pad2(absoluteMinutes % 60)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
