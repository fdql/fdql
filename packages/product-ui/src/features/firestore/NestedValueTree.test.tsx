import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NestedValueTree } from './NestedValueTree.tsx';

describe('NestedValueTree', () => {
  it('renders nested object values', () => {
    render(<NestedValueTree value={{ customer: { name: 'Ada' }, total: 10 }} />);

    expect(screen.getByText('customer')).toBeTruthy();
    expect(screen.getByText('name')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('total')).toBeTruthy();
  });

  it('expands only the first level by default', () => {
    render(
      <NestedValueTree value={{ customer: { profile: { name: 'Ada' } }, total: 10 }} />,
    );

    expect(screen.getByText('customer')).toBeTruthy();
    expect(screen.getByText('profile')).toBeTruthy();
    expect(screen.queryByText('name')).toBeNull();

    fireEvent.click(screen.getByText('profile').closest('button')!);

    expect(screen.getByText('name')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('reveals large child groups progressively', () => {
    render(
      <NestedValueTree
        value={{
          metadata: Object.fromEntries(
            Array.from({ length: 125 }, (_, index) => [`field_${index}`, index]),
          ),
        }}
      />,
    );

    expect(screen.getByText('field_0')).toBeTruthy();
    expect(screen.queryByText('field_124')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    expect(screen.getByText('field_124')).toBeTruthy();
  });

  it('uses controlled expanded paths when provided', () => {
    const onExpandedPathsChange = vi.fn();
    render(
      <NestedValueTree
        expandedPaths={new Set(['["customer"]'])}
        value={{ customer: { profile: { name: 'Ada' } } }}
        onExpandedPathsChange={onExpandedPathsChange}
      />,
    );

    expect(screen.getByText('profile')).toBeTruthy();
    expect(screen.queryByText('name')).toBeNull();

    fireEvent.click(screen.getByText('profile').closest('button')!);

    expect(onExpandedPathsChange).toHaveBeenCalledWith(
      new Set(['["customer"]', '["customer","profile"]']),
    );
  });
});
