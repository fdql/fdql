import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (
    { count, estimateSize }: { count: number; estimateSize: (i: number) => number; },
  ) => {
    const size = count > 0 ? estimateSize(0) : 0;
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, i) => ({ index: i, key: i, start: i * size, size })),
    };
  },
}));

import { VirtualList } from './VirtualList.tsx';

describe('VirtualList', () => {
  it('renders every item via renderItem', () => {
    render(
      <VirtualList
        items={['a', 'b', 'c']}
        estimateSize={() => 20}
        renderItem={(item) => <span data-testid='row'>{item}</span>}
      />,
    );
    const rows = screen.getAllByTestId('row');
    expect(rows.map((r) => r.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('passes the index to renderItem', () => {
    render(
      <VirtualList
        items={['x', 'y']}
        estimateSize={() => 20}
        renderItem={(item, index) => <span data-testid='row'>{`${index}:${item}`}</span>}
      />,
    );
    expect(screen.getAllByTestId('row').map((r) => r.textContent)).toEqual(['0:x', '1:y']);
  });

  it('uses density row height when no estimate size is provided', () => {
    render(
      <VirtualList
        density='comfortable'
        items={['x', 'y']}
        renderItem={(item) => <span data-testid='row'>{item}</span>}
      />,
    );

    const rowWrappers = screen.getAllByTestId('row').map((row) => row.parentElement);
    expect(rowWrappers[1]?.style.transform).toBe('translateY(36px)');
  });

  it('applies container and item classes', () => {
    const { container } = render(
      <VirtualList
        className='outer-list'
        itemClassName={(item) => `row-${item}`}
        items={['x']}
        estimateSize={() => 20}
        renderItem={(item) => <span>{item}</span>}
      />,
    );

    expect(container.querySelector('.outer-list')).toBeTruthy();
    expect(container.querySelector('.row-x')).toBeTruthy();
  });

  it('renders nothing for an empty list', () => {
    render(
      <VirtualList
        items={[]}
        estimateSize={() => 20}
        renderItem={(item) => <span data-testid='row'>{String(item)}</span>}
      />,
    );
    expect(screen.queryAllByTestId('row')).toHaveLength(0);
  });

  it('restores saved scroll for the same key', () => {
    const { container, unmount } = render(
      <VirtualList
        className='scroll-list'
        items={['x', 'y']}
        estimateSize={() => 20}
        scrollRestorationKey='users:list'
        renderItem={(item) => <span>{item}</span>}
      />,
    );
    const list = container.querySelector<HTMLElement>('.scroll-list')!;
    fireEvent.scroll(list, { target: { scrollLeft: 9, scrollTop: 42 } });

    unmount();

    const next = render(
      <VirtualList
        className='scroll-list'
        items={['x', 'y']}
        estimateSize={() => 20}
        scrollRestorationKey='users:list'
        renderItem={(item) => <span>{item}</span>}
      />,
    );

    const restored = next.container.querySelector<HTMLElement>('.scroll-list')!;
    expect(restored.scrollLeft).toBe(9);
    expect(restored.scrollTop).toBe(42);
  });
});
