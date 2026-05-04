import type { ActivityLogEntry } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityDrawer } from './ActivityDrawer.tsx';

describe('ActivityDrawer', () => {
  it('renders entries, details, and target open action', () => {
    const onOpenTarget = vi.fn();
    render(
      <ActivityDrawer
        area='all'
        entries={[entry]}
        open
        search=''
        status='all'
        onAreaChange={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onOpenTarget={onOpenTarget}
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByText('Save document')).toBeTruthy();
    expect(screen.queryByText(/fieldCount/)).toBeNull();

    const details = screen.getByText('Save document').closest('details');
    expect(details).toBeTruthy();
    fireEvent.click(screen.getByText('Save document'));
    fireEvent(details!, new Event('toggle', { bubbles: true }));

    expect(screen.getByText(/fieldCount/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(onOpenTarget).toHaveBeenCalledWith(entry);
  });

  it('emits filter, clear, and export actions', () => {
    const onAreaChange = vi.fn();
    const onClear = vi.fn();
    const onExport = vi.fn();
    const onSearchChange = vi.fn();
    const onStatusChange = vi.fn();
    render(
      <ActivityDrawer
        area='all'
        entries={[]}
        open
        search=''
        status='all'
        onAreaChange={onAreaChange}
        onClear={onClear}
        onClose={vi.fn()}
        onExport={onExport}
        onSearchChange={onSearchChange}
        onStatusChange={onStatusChange}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Search activity' }), {
      target: { value: 'orders' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Activity area' }), {
      target: { value: 'firestore' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Activity status' }), {
      target: { value: 'failure' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onSearchChange).toHaveBeenCalledWith('orders');
    expect(onAreaChange).toHaveBeenCalledWith('firestore');
    expect(onStatusChange).toHaveBeenCalledWith('failure');
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('emits expanded changes', () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <ActivityDrawer
        area='all'
        entries={[]}
        open
        search=''
        status='all'
        onAreaChange={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onExpandedChange={onExpandedChange}
        onExport={vi.fn()}
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(onExpandedChange).toHaveBeenCalledWith(true);

    rerender(
      <ActivityDrawer
        area='all'
        entries={[]}
        expanded
        open
        search=''
        status='all'
        onAreaChange={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onExpandedChange={onExpandedChange}
        onExport={vi.fn()}
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));

    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape from inside the drawer', () => {
    const onClose = vi.fn();
    render(
      <ActivityDrawer
        area='all'
        entries={[]}
        open
        search=''
        status='all'
        onAreaChange={vi.fn()}
        onClear={vi.fn()}
        onClose={onClose}
        onExport={vi.fn()}
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search activity' }), {
      key: 'Escape',
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('truncates very large payloads instead of freezing on JSON.stringify', () => {
    const huge: Record<string, string> = {};
    for (let i = 0; i < 50_000; i += 1) huge[`field_${i}`] = `value_${i}`;
    const bigEntry: ActivityLogEntry = {
      ...entry,
      id: 'activity-big',
      payload: { data: huge },
    };

    render(
      <ActivityDrawer
        area='all'
        entries={[bigEntry]}
        open
        search=''
        status='all'
        onAreaChange={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    const details = screen.getByText('Save document').closest('details');
    fireEvent.click(screen.getByText('Save document'));
    const start = performance.now();
    fireEvent(details!, new Event('toggle', { bubbles: true }));
    const elapsed = performance.now() - start;

    expect(screen.getByText(/truncated for display/)).toBeTruthy();
    // Generous bound; full JSON.stringify on 50k keys would be hundreds of ms.
    expect(elapsed).toBeLessThan(500);
  });
});

const entry: ActivityLogEntry = {
  action: 'Save document',
  area: 'firestore',
  id: 'activity-1',
  metadata: { fieldCount: 1 },
  status: 'success',
  summary: 'Saved orders/ord_1',
  target: { path: 'orders/ord_1', type: 'firestore-document' },
  timestamp: '2026-04-29T00:00:00.000Z',
};
