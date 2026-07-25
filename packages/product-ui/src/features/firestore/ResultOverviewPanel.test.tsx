import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverviewCollapseStrip, ResultContextPanel } from './ResultOverviewPanel.tsx';

describe('ResultOverviewPanel', () => {
  it('shows field catalog and selected document actions', () => {
    const onCollapse = vi.fn();
    const onEdit = vi.fn();

    render(
      <ResultContextPanel
        resultView='table'
        rows={[{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { total: 10 },
          hasSubcollections: false,
        }]}
        selectedDocument={{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { total: 10 },
          hasSubcollections: false,
        }}
        onCollapse={onCollapse}
        onEditDocument={onEdit}
      />,
    );

    expect(screen.getByText('Fields in results')).toBeTruthy();
    expect(screen.getByText('orders/ord_1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse result overview' }));

    expect(onEdit).toHaveBeenCalledWith({
      id: 'ord_1',
      path: 'orders/ord_1',
      data: { total: 10 },
      hasSubcollections: false,
    });
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('shows selection preview in tree view', () => {
    render(
      <ResultContextPanel
        resultView='tree'
        rows={[{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { total: 10 },
          hasSubcollections: false,
        }]}
        selectedDocument={{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { total: 10 },
          hasSubcollections: false,
        }}
        onCollapse={() => {}}
      />,
    );

    expect(screen.getByText('Selection preview')).toBeTruthy();
    expect(screen.getByText('orders/ord_1')).toBeTruthy();
  });

  it('shows selection preview before collapsed field catalog by default', () => {
    const { container } = render(
      <ResultContextPanel
        resultView='table'
        rows={[{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { customer: { name: 'Ada' }, total: 10 },
          hasSubcollections: false,
        }]}
        selectedDocument={{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { customer: { name: 'Ada' }, total: 10 },
          hasSubcollections: false,
        }}
        onCollapse={() => {}}
      />,
    );

    const text = container.textContent ?? '';
    expect(text.indexOf('Selection preview')).toBeLessThan(text.indexOf('Fields in results'));
    const sections = Array.from(container.querySelectorAll('details'));
    expect(sections[0]?.open).toBe(true);
    expect(sections[1]?.open).toBe(false);
  });

  it('reports controlled section and selection expansion changes', () => {
    const onSectionOpenChange = vi.fn();
    const onSelectionPreviewExpandedPathsChange = vi.fn();
    const { container } = render(
      <ResultContextPanel
        resultView='table'
        rows={[]}
        sections={{ fieldsInResults: false, jsonContext: true, selectionPreview: true }}
        selectedDocument={{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: { customer: { profile: { name: 'Ada' } } },
          hasSubcollections: false,
        }}
        selectionPreviewExpandedPaths={new Set(['["customer"]'])}
        onCollapse={() => {}}
        onSectionOpenChange={onSectionOpenChange}
        onSelectionPreviewExpandedPathsChange={onSelectionPreviewExpandedPathsChange}
      />,
    );

    const selectionDetails = container.querySelector('details')!;
    selectionDetails.open = false;
    fireEvent(selectionDetails, new Event('toggle'));
    fireEvent.click(screen.getByText('profile').closest('button')!);

    expect(onSectionOpenChange).toHaveBeenCalledWith('selectionPreview', false);
    expect(onSelectionPreviewExpandedPathsChange).toHaveBeenCalledWith(
      new Set(['["customer"]', '["customer","profile"]']),
    );
  });

  it('expands collapsed overview strip', () => {
    const onExpand = vi.fn();

    render(<OverviewCollapseStrip onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button'));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
