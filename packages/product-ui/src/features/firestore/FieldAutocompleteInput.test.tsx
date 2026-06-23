import type { FirestoreFieldCatalogEntry } from '@firebase-desk/repo-contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FieldAutocompleteInput } from './FieldAutocompleteInput.tsx';

const suggestions: ReadonlyArray<FirestoreFieldCatalogEntry> = [
  { count: 2, field: 'schedule.startsAt', types: ['timestamp'] },
  { count: 5, field: 'status', types: ['string'] },
  { count: 20, field: 'attemptsById.{id}.status', types: ['string'] },
];

describe('FieldAutocompleteInput', () => {
  it('ranks exact, prefix, shallow, count, and field name matches', async () => {
    render(<ControlledFieldAutocompleteInput initialValue='sta' suggestions={suggestions} />);

    fireEvent.focus(screen.getByLabelText('Field'));
    const custom = await screen.findByText('custom');
    const status = screen.getByText('status');
    const schedule = screen.getByText('schedule.startsAt');
    const nested = screen.getByText('attemptsById.{id}.status');

    expect(appearsBefore(custom, status)).toBe(true);
    expect(appearsBefore(status, schedule)).toBe(true);
    expect(appearsBefore(schedule, nested)).toBe(true);
  });

  it('does not show a custom option for an exact match', async () => {
    render(<ControlledFieldAutocompleteInput initialValue='status' suggestions={suggestions} />);

    fireEvent.focus(screen.getByLabelText('Field'));

    expect(await screen.findByText('status')).toBeTruthy();
    expect(screen.queryByText('custom')).toBeNull();
  });

  it('keeps typed custom text on enter when there is no exact suggestion', async () => {
    render(<ControlledFieldAutocompleteInput initialValue='sta' suggestions={suggestions} />);

    const input = screen.getByLabelText('Field');
    fireEvent.focus(input);
    expect(await screen.findByText('custom')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect((input as HTMLInputElement).value).toBe('sta');
  });

  it('accepts an explicit suggestion selection', async () => {
    render(<ControlledFieldAutocompleteInput initialValue='sta' suggestions={suggestions} />);

    fireEvent.focus(screen.getByLabelText('Field'));
    fireEvent.click(await screen.findByText('status'));

    expect((screen.getByLabelText('Field') as HTMLInputElement).value).toBe(
      'status',
    );
  });

  it('keeps typing local and commits after the user pauses', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    try {
      render(
        <FieldAutocompleteInput
          ariaLabel='Field'
          suggestions={suggestions}
          value=''
          onChange={onChange}
        />,
      );

      const input = screen.getByLabelText('Field') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'custom.path' } });

      expect(input.value).toBe('custom.path');
      expect(onChange).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(onChange).toHaveBeenCalledWith('custom.path');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes suggestions on escape without changing the value', async () => {
    render(<ControlledFieldAutocompleteInput initialValue='sta' suggestions={suggestions} />);

    const input = screen.getByLabelText('Field');
    fireEvent.focus(input);
    expect(await screen.findByText('status')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect((input as HTMLInputElement).value).toBe('sta');
    expect(screen.queryByText('status')).toBeNull();
  });

  it('renders only the highest ranked suggestions from a large catalog', async () => {
    render(
      <ControlledFieldAutocompleteInput
        initialValue=''
        suggestions={Array.from({ length: 50 }, (_, index) => ({
          count: 1,
          field: `field_${String(index).padStart(2, '0')}`,
          types: ['string'],
        }))}
      />,
    );

    fireEvent.focus(screen.getByLabelText('Field'));

    expect(await screen.findByText('field_23')).toBeTruthy();
    expect(screen.queryByText('field_24')).toBeNull();
  });
});

function ControlledFieldAutocompleteInput(
  {
    initialValue,
    suggestions: fieldSuggestions,
  }: {
    readonly initialValue: string;
    readonly suggestions: ReadonlyArray<FirestoreFieldCatalogEntry>;
  },
) {
  const [value, setValue] = useState(initialValue);
  return (
    <FieldAutocompleteInput
      ariaLabel='Field'
      suggestions={fieldSuggestions}
      value={value}
      onChange={setValue}
    />
  );
}

function appearsBefore(left: HTMLElement, right: HTMLElement): boolean {
  return Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);
}
