import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryBuilder } from './QueryBuilder.tsx';

const draft: FirestoreQueryDraft = {
  path: 'orders',
  filters: [{ id: 'filter-1', field: 'status', op: '==', value: 'paid' }],
  filterField: 'status',
  filterOp: '==',
  filterValue: 'paid',
  limit: 25,
  sortDirection: 'desc',
  sortField: 'updatedAt',
};

describe('QueryBuilder', () => {
  it('runs collection queries and updates filter draft state', () => {
    const onDraftEdit = vi.fn();
    const onRun = vi.fn();
    render(
      <QueryBuilder
        draft={{
          ...draft,
          filters: [{ id: 'filter-1', field: '', op: '==', value: '' }],
          filterField: '',
          filterValue: '',
        }}
        isLoading={false}
        onDraftEdit={onDraftEdit}
        onRun={onRun}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const field = screen.getByLabelText('Filter 1 field');
    fireEvent.change(field, {
      target: { value: 'state' },
    });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onDraftEdit).toHaveBeenCalledWith({
      type: 'filter-patch',
      filterId: 'filter-1',
      patch: { field: 'state' },
    });
    expect(onDraftEdit).toHaveBeenCalledWith({
      type: 'filter-add',
      filter: { id: 'filter-2', field: '', op: '==', value: '' },
    });
  });

  it('emits a stable filter patch after the delayed field commit', () => {
    vi.useFakeTimers();
    const onDraftEdit = vi.fn();
    try {
      const { rerender } = render(
        <QueryBuilder
          draft={{
            ...draft,
            filters: [{ id: 'filter-1', field: '', op: '==', value: '' }],
            filterField: '',
            filterValue: '',
          }}
          isLoading={false}
          onDraftEdit={onDraftEdit}
          onRun={() => {}}
        />,
      );

      fireEvent.change(screen.getByLabelText('Filter 1 field'), {
        target: { value: 'customer.name' },
      });
      rerender(
        <QueryBuilder
          draft={{
            ...draft,
            path: 'customers',
            filters: [{ id: 'filter-1', field: '', op: '==', value: '' }],
            filterField: '',
            filterValue: '',
          }}
          isLoading={false}
          onDraftEdit={onDraftEdit}
          onRun={() => {}}
        />,
      );

      act(() => vi.advanceTimersByTime(120));

      expect(onDraftEdit).toHaveBeenCalledWith({
        type: 'filter-patch',
        filterId: 'filter-1',
        patch: { field: 'customer.name' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits a sort field edit after the delayed field commit', () => {
    vi.useFakeTimers();
    const onDraftEdit = vi.fn();
    try {
      render(
        <QueryBuilder
          draft={{ ...draft, sortField: '' }}
          isLoading={false}
          onDraftEdit={onDraftEdit}
          onRun={() => {}}
        />,
      );

      fireEvent.change(screen.getByLabelText('Sort field'), {
        target: { value: 'createdAt' },
      });
      act(() => vi.advanceTimersByTime(120));

      expect(onDraftEdit).toHaveBeenCalledWith({
        type: 'sort-field-set',
        sortField: 'createdAt',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits scalar query draft edits', () => {
    const onDraftEdit = vi.fn();
    render(
      <QueryBuilder
        draft={draft}
        isLoading={false}
        onDraftEdit={onDraftEdit}
        onRun={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText('Query path'), { target: { value: 'customers' } });
    fireEvent.change(screen.getByLabelText('Result limit'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Sort direction'), { target: { value: 'asc' } });

    expect(onDraftEdit.mock.calls.map(([edit]) => edit)).toEqual([
      { type: 'path-set', path: 'customers' },
      { type: 'limit-set', limit: 10 },
      { type: 'sort-direction-set', sortDirection: 'asc' },
    ]);
  });

  it('emits reset after confirmation', () => {
    const onDraftEdit = vi.fn();
    render(
      <QueryBuilder
        draft={draft}
        isLoading={false}
        onDraftEdit={onDraftEdit}
        onRun={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset' }));

    expect(onDraftEdit).toHaveBeenCalledWith({ type: 'reset' });
  });

  it('does not render a filter row until one is added', () => {
    render(
      <QueryBuilder
        draft={{ ...draft, filters: [], filterField: '', filterValue: '' }}
        isLoading={false}
        onDraftEdit={() => {}}
        onRun={() => {}}
      />,
    );

    expect(screen.queryByLabelText('Filter 1 field')).toBeNull();
  });

  it('does not render create document CTA in the query toolbar', () => {
    const onCreateDocument = vi.fn();
    render(
      <QueryBuilder
        draft={draft}
        isLoading={false}
        onDraftEdit={() => {}}
        onRun={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
    expect(onCreateDocument).not.toHaveBeenCalled();
  });

  it('uses generic placeholders for filter fields and values', () => {
    render(
      <QueryBuilder
        draft={{
          ...draft,
          filters: [{ id: 'filter-1', field: '', op: '==', value: '' }],
          filterField: '',
          filterValue: '',
        }}
        isLoading={false}
        onDraftEdit={() => {}}
        onRun={() => {}}
      />,
    );

    expect(screen.getAllByPlaceholderText('field name')).toHaveLength(2);
    expect(screen.getByPlaceholderText('value, JSON, or null')).toBeTruthy();
  });

  it('sets a filter value to null from the filter row', () => {
    const onDraftEdit = vi.fn();
    render(
      <QueryBuilder
        draft={{
          ...draft,
          filters: [{ id: 'filter-1', field: 'archivedAt', op: '==', value: '' }],
          filterField: 'archivedAt',
          filterValue: '',
        }}
        isLoading={false}
        onDraftEdit={onDraftEdit}
        onRun={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Null' }));

    expect(onDraftEdit).toHaveBeenCalledWith({
      type: 'filter-patch',
      filterId: 'filter-1',
      patch: { value: 'null' },
    });
  });

  it('adds and removes the only filter row', () => {
    const onDraftEdit = vi.fn();
    const { rerender } = render(
      <QueryBuilder
        draft={{ ...draft, filters: [], filterField: '', filterValue: '' }}
        isLoading={false}
        onDraftEdit={onDraftEdit}
        onRun={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(onDraftEdit).toHaveBeenCalledWith({
      type: 'filter-add',
      filter: { id: 'filter-1', field: '', op: '==', value: '' },
    });

    rerender(
      <QueryBuilder
        draft={draft}
        isLoading={false}
        onDraftEdit={onDraftEdit}
        onRun={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onDraftEdit).toHaveBeenLastCalledWith({
      type: 'filter-remove',
      filterId: 'filter-1',
    });
  });

  it('renders field suggestions while preserving free text entry', async () => {
    const onDraftEdit = vi.fn();
    render(
      <QueryBuilder
        draft={{
          ...draft,
          filters: [{ id: 'filter-1', field: '', op: '==', value: '' }],
          filterField: '',
          filterValue: '',
        }}
        fieldSuggestions={[
          { count: 3, field: 'customer.name', types: ['string'] },
          { count: 2, field: 'metadata.score', types: ['number'] },
        ]}
        isLoading={false}
        onDraftEdit={onDraftEdit}
        onRun={() => {}}
      />,
    );

    const field = screen.getByLabelText('Filter 1 field');
    fireEvent.focus(field);

    expect(await screen.findByText('customer.name')).toBeTruthy();
    expect(screen.getByText('string')).toBeTruthy();

    fireEvent.change(field, { target: { value: 'custom.path' } });
    fireEvent.blur(field);
    expect(onDraftEdit).toHaveBeenCalledWith({
      type: 'filter-patch',
      filterId: 'filter-1',
      patch: { field: 'custom.path' },
    });
  });

  it('excludes array suggestions from sort fields', async () => {
    render(
      <QueryBuilder
        draft={{ ...draft, sortField: '' }}
        fieldSuggestions={[
          { count: 3, field: 'createdAt', types: ['timestamp'] },
          { count: 2, field: 'tags', types: ['array<string>'] },
        ]}
        isLoading={false}
        onDraftEdit={() => {}}
        onRun={() => {}}
      />,
    );

    fireEvent.focus(screen.getByLabelText('Sort field'));

    expect(await screen.findByText('createdAt')).toBeTruthy();
    expect(screen.queryByText('tags')).toBeNull();
  });

  it('shows collapsed metadata placeholder suggestions for filter and sort fields', async () => {
    render(
      <QueryBuilder
        draft={{
          ...draft,
          filters: [{ id: 'filter-1', field: '', op: '==', value: '' }],
          filterField: '',
          filterValue: '',
          sortField: '',
        }}
        fieldSuggestions={[
          { count: 5, field: 'attemptsById.{id}.status', types: ['string'] },
          {
            count: 5,
            field: 'attemptsById.{id}.paymentsById.{id}.amount',
            types: ['number'],
          },
        ]}
        isLoading={false}
        onDraftEdit={() => {}}
        onRun={() => {}}
      />,
    );

    fireEvent.focus(screen.getByLabelText('Filter 1 field'));
    expect(await screen.findByText('attemptsById.{id}.status')).toBeTruthy();
    expect(screen.getByText('attemptsById.{id}.paymentsById.{id}.amount')).toBeTruthy();

    fireEvent.blur(screen.getByLabelText('Filter 1 field'));
    fireEvent.focus(screen.getByLabelText('Sort field'));
    expect(await screen.findByText('attemptsById.{id}.status')).toBeTruthy();
  });

  it('hides collection-only controls for document paths', () => {
    render(
      <QueryBuilder
        draft={{ ...draft, path: 'orders/ord_1024' }}
        isLoading={false}
        onDraftEdit={() => {}}
        onRun={() => {}}
      />,
    );

    expect(screen.queryByLabelText('Result limit')).toBeNull();
    expect(screen.queryByLabelText('Filter 1 field')).toBeNull();
    expect(screen.queryByLabelText('Sort field')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
    expect(screen.getByText(/Filters, sorting, limits, and pagination are hidden/)).toBeTruthy();
  });
});
