import type { FirestoreDocumentResult } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubcollectionLoadState } from './resultModel.tsx';
import { ResultPanel } from './ResultPanel.tsx';

vi.mock('./ResultTable.tsx', () => ({
  ResultTable: (
    { rows }: { readonly rows: ReadonlyArray<FirestoreDocumentResult>; },
  ) => <div data-testid='table'>{rows.length} rows</div>,
}));

vi.mock('./ResultTreeView.tsx', () => ({
  ResultTreeView: (
    {
      expandedIds,
      onSelectDocument,
      onToggleNode,
      rows,
    }: {
      readonly expandedIds: ReadonlySet<string>;
      readonly onSelectDocument?: (documentPath: string) => void;
      readonly onToggleNode: (id: string) => void;
      readonly rows: ReadonlyArray<FirestoreDocumentResult>;
      readonly subcollectionStates: Readonly<Record<string, SubcollectionLoadState>>;
    },
  ) => (
    <div>
      <div data-testid='expanded'>{Array.from(expandedIds).join('|')}</div>
      <button
        type='button'
        onClick={() => {
          if (rows[0]) onSelectDocument?.(rows[0].path);
          onToggleNode(`doc:${rows[0]?.path ?? ''}`);
        }}
      >
        tree
      </button>
      <button
        type='button'
        onClick={() => {
          if (rows[0]) onSelectDocument?.(rows[0].path);
        }}
      >
        field
      </button>
    </div>
  ),
}));

describe('ResultPanel', () => {
  it('renders table and error state', () => {
    render(
      <ResultPanel
        errorMessage='Could not query'
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders'
        resultView='table'
        rows={[]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    expect(screen.getByText('Could not query')).toBeTruthy();
    expect(screen.getByTestId('table').textContent).toBe('0 rows');
  });

  it('renders create document CTA in result header for collection paths', () => {
    const onCreateDocument = vi.fn();
    render(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders'
        resultView='table'
        rows={[]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onCreateDocument={onCreateDocument}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    expect(onCreateDocument).toHaveBeenCalledWith('orders');
  });

  it('hides create document CTA in result header for document paths', () => {
    render(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders/ord_1'
        resultView='table'
        rows={[]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onCreateDocument={() => {}}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
  });

  it('shows collection jobs CTA only for collection paths', () => {
    const { rerender } = render(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders'
        resultView='table'
        rows={[]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onCollectionJob={() => {}}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Jobs' })).toBeTruthy();

    rerender(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders/ord_1'
        resultView='table'
        rows={[]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onCollectionJob={() => {}}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Jobs' })).toBeNull();
  });

  it('loads subcollections when expanding tree document', () => {
    const onLoadSubcollections = vi.fn();
    const onSelectDocument = vi.fn();

    render(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders'
        resultView='tree'
        rows={[{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: {},
          hasSubcollections: true,
        }]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onLoadMore={() => {}}
        onLoadSubcollections={onLoadSubcollections}
        onResultViewChange={() => {}}
        onSelectDocument={onSelectDocument}
      />,
    );

    expect(screen.getByTestId('expanded').textContent).toContain('root:orders');
    expect(screen.getByTestId('expanded').textContent).toContain('doc:orders/ord_1');
    expect(screen.getByTestId('expanded').textContent).not.toContain('doc:orders/ord_1:fields');

    fireEvent.click(screen.getByRole('button', { name: 'tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'tree' }));

    expect(onLoadSubcollections).toHaveBeenCalledWith('orders/ord_1');
    expect(onSelectDocument).toHaveBeenCalledWith('orders/ord_1');
  });

  it('uses controlled tree expansion when provided', () => {
    const onResultTreeExpandedIdsChange = vi.fn();

    render(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders'
        resultTreeExpandedIds={['root:orders']}
        resultView='tree'
        rows={[{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: {},
          hasSubcollections: false,
        }]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onLoadMore={() => {}}
        onResultTreeExpandedIdsChange={onResultTreeExpandedIdsChange}
        onResultViewChange={() => {}}
      />,
    );

    expect(screen.getByTestId('expanded').textContent).toBe('root:orders');

    fireEvent.click(screen.getByRole('button', { name: 'tree' }));

    expect(onResultTreeExpandedIdsChange).toHaveBeenCalledWith([
      'root:orders',
      'doc:orders/ord_1',
      'doc:orders/ord_1:fields',
      'doc:orders/ord_1:subcollections',
    ]);
  });

  it('selects the document when tree field nodes are selected', () => {
    const onSelectDocument = vi.fn();

    render(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders'
        resultView='tree'
        rows={[{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { total: 10 },
          hasSubcollections: false,
        }]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
        onSelectDocument={onSelectDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'field' }));

    expect(onSelectDocument).toHaveBeenCalledWith('orders/ord_1');
  });

  it('renders json results in a full-size tab pane', async () => {
    render(
      <ResultPanel
        errorMessage={null}
        hasMore={false}
        isFetchingMore={false}
        isLoading={false}
        queryPath='orders'
        resultView='json'
        rows={[]}
        selectedDocumentPath={null}
        subcollectionStates={{}}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    const preview = await screen.findByLabelText('JSON results');
    expect(preview.className).toContain('h-full');
    expect(preview.closest('[role="tabpanel"]')?.className).toContain('col-start-1');
  });
});
