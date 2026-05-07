import type { FdqlRunResult } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
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
    { onChange, readOnly, value }: {
      readonly onChange?: (value: string) => void;
      readonly readOnly?: boolean;
      readonly value: string;
    },
  ) => (
    <textarea
      aria-label='FDQL source'
      readOnly={readOnly}
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
}));

const result: FdqlRunResult = {
  diagnostics: [],
  durationMs: 1_234,
  rows: [{ id: 'version', metadata: { channel: 'stable' }, version: 3166 }],
  stats: {
    aggregateSourceRows: 0,
    cacheHits: 0,
    cacheMisses: 0,
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
    expect(screen.getByRole('columnheader', { name: 'version' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '3166' })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Tree/ }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole('tree')).toBeTruthy();
    expect(screen.getByText('row_1')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /JSON/ }), {
      button: 0,
      ctrlKey: false,
    });
    const json = await screen.findByLabelText('FDQL JSON results');
    expect(json).toHaveProperty('value', expect.stringContaining('"version": 3166'));
  });
});
