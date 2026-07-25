import { fireEvent, render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { DetailRow } from './DetailRow.tsx';
import { InspectorSection } from './InspectorSection.tsx';

describe('InspectorSection', () => {
  it('renders heading metadata and default-open content', () => {
    const { container } = render(
      <InspectorSection
        defaultOpen
        icon={<FileText size={14} aria-hidden='true' />}
        meta='3'
        title='Fields'
      >
        <DetailRow label='Documents' value='2' />
      </InspectorSection>,
    );

    expect(screen.getByText('Fields')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(true);
  });

  it('renders collapsed by default', () => {
    const { container } = render(
      <InspectorSection
        icon={<FileText size={14} aria-hidden='true' />}
        meta='none'
        title='Preview'
      >
        Content
      </InspectorSection>,
    );

    expect(screen.getByText('Preview')).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(false);
  });

  it('reports controlled open state changes', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <InspectorSection
        icon={<FileText size={14} aria-hidden='true' />}
        meta='open'
        open
        title='Preview'
        onOpenChange={onOpenChange}
      >
        Content
      </InspectorSection>,
    );

    const details = container.querySelector('details')!;
    expect(details.open).toBe(true);

    details.open = false;
    fireEvent(details, new Event('toggle'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
