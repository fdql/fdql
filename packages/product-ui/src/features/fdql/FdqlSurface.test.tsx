import { FDQL_LANGUAGE_ID } from '@firebase-desk/fdql-language';
import type { FdqlRunResult } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FdqlSurface } from './FdqlSurface.tsx';

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
    { language, onChange, readOnly, value }: {
      readonly language: string;
      readonly onChange?: (value: string) => void;
      readonly readOnly?: boolean;
      readonly value: string;
    },
  ) => (
    <textarea
      aria-label='FDQL source'
      data-language={language}
      readOnly={readOnly}
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
}));

const startsAtIso = '2026-05-05T10:27:00.000Z';

const result: FdqlRunResult = {
  diagnostics: [],
  durationMs: 1_234,
  rows: [{
    id: 'version',
    metadata: { channel: 'stable' },
    startsAt: { __fdqlType: 'timestamp', value: startsAtIso },
    version: 3166,
  }],
  stats: {
    aggregateSourceRows: 0,
    cacheHits: 1,
    cacheMisses: 2,
    lookupReads: 0,
    providerReads: { 'fs:local': 1 },
    readBudget: 5000,
    reads: 1,
    rowsOutput: 1,
    rowsScanned: 1,
    stoppedReason: 'completed',
    unionBranches: 0,
  },
};

describe('FdqlSurface', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      })),
    );
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
