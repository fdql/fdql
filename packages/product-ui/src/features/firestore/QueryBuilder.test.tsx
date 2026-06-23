import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
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
    const onDraftChange = vi.fn();
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
        onDraftChange={onDraftChange}
        onReset={() => {}}
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
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      filterField: 'state',
      filters: [expect.objectContaining({ field: 'state' })],
    }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      filters: [
        expect.objectContaining({ id: 'filter-1' }),
        expect.objectContaining({ id: 'filter-2' }),
      ],
    }));
  });

  it('does not render a filter row until one is added', () => {
    render(
      <QueryBuilder
        draft={{ ...draft, filters: [], filterField: '', filterValue: '' }}
        isLoading={false}
        onDraftChange={() => {}}
        onReset={() => {}}
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
        onDraftChange={() => {}}
        onReset={() => {}}
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
        onDraftChange={() => {}}
        onReset={() => {}}
        onRun={() => {}}
      />,
    );

    expect(screen.getAllByPlaceholderText('field name')).toHaveLength(2);
    expect(screen.getByPlaceholderText('value, JSON, or null')).toBeTruthy();
  });

  it('sets a filter value to null from the filter row', () => {
    const onDraftChange = vi.fn();
    render(
      <QueryBuilder
        draft={{
          ...draft,
          filters: [{ id: 'filter-1', field: 'archivedAt', op: '==', value: '' }],
          filterField: 'archivedAt',
          filterValue: '',
        }}
        isLoading={false}
        onDraftChange={onDraftChange}
        onReset={() => {}}
        onRun={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Null' }));

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      filterValue: 'null',
      filters: [expect.objectContaining({ field: 'archivedAt', value: 'null' })],
    }));
  });

  it('adds and removes the only filter row', () => {
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <QueryBuilder
        draft={{ ...draft, filters: [], filterField: '', filterValue: '' }}
        isLoading={false}
        onDraftChange={onDraftChange}
        onReset={() => {}}
        onRun={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      filters: [expect.objectContaining({ id: 'filter-1' })],
    }));

    rerender(
      <QueryBuilder
        draft={draft}
        isLoading={false}
        onDraftChange={onDraftChange}
        onReset={() => {}}
        onRun={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: [],
      filterField: '',
      filterOp: '==',
      filterValue: '',
    }));
  });

  it('renders field suggestions while preserving free text entry', async () => {
    const onDraftChange = vi.fn();
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
        onDraftChange={onDraftChange}
        onReset={() => {}}
        onRun={() => {}}
      />,
    );

    const field = screen.getByLabelText('Filter 1 field');
    fireEvent.focus(field);

    expect(await screen.findByText('customer.name')).toBeTruthy();
    expect(screen.getByText('string')).toBeTruthy();

    fireEvent.change(field, { target: { value: 'custom.path' } });
    fireEvent.blur(field);
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      filterField: 'custom.path',
      filters: [expect.objectContaining({ field: 'custom.path' })],
    }));
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
        onDraftChange={() => {}}
        onReset={() => {}}
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
        onDraftChange={() => {}}
        onReset={() => {}}
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
        onDraftChange={() => {}}
        onReset={() => {}}
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
