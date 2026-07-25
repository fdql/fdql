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
      scrollToIndex: vi.fn(),
    };
  },
}));

import { VirtualTree, type VirtualTreeNode } from './VirtualTree.tsx';

const nodes: VirtualTreeNode[] = [
  { id: 'a', label: 'A', depth: 0, hasChildren: true, expanded: true },
  { id: 'a.1', label: 'A.1', depth: 1, hasChildren: false, expanded: false },
  { id: 'b', label: 'B', depth: 0, hasChildren: true, expanded: false },
];

describe('VirtualTree', () => {
  it('wraps items in role="tree" with optional aria-label', () => {
    render(
      <VirtualTree
        flattenedNodes={nodes}
        rowHeight={20}
        onToggle={() => {}}
        ariaLabel='Test tree'
      />,
    );
    const tree = screen.getByRole('tree');
    expect(tree.getAttribute('aria-label')).toBe('Test tree');
  });

  it('renders treeitems with correct aria-level and aria-expanded', () => {
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={() => {}} />);
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.getAttribute('aria-level')).toBe('1');
    expect(items[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(items[1]?.getAttribute('aria-level')).toBe('2');
    expect(items[1]?.getAttribute('aria-expanded')).toBeNull();
    expect(items[2]?.getAttribute('aria-expanded')).toBe('false');
  });

  it('exposes selection state', () => {
    render(
      <VirtualTree
        flattenedNodes={nodes.map((node) => ({ ...node, selected: node.id === 'a.1' }))}
        rowHeight={20}
        onToggle={() => {}}
      />,
    );

    expect(screen.getAllByRole('treeitem')[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('uses roving tabindex (only the focused item is tabbable)', () => {
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={() => {}} />);
    const items = screen.getAllByRole('treeitem');
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('toggles a parent on click', () => {
    const onToggle = vi.fn();
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole('treeitem')[2]!);
    expect(onToggle).toHaveBeenCalledWith('b');
  });

  it('does not toggle when a leaf node is clicked', () => {
    const onToggle = vi.fn();
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole('treeitem')[1]!);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('shows leaf nodes as interactive when selection is enabled', () => {
    render(
      <VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={() => {}} onSelect={() => {}} />,
    );
    expect(screen.getAllByRole('treeitem')[1]?.style.cursor).toBe('pointer');
  });

  it('toggles when Enter or Space is pressed on a parent', () => {
    const onToggle = vi.fn();
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={onToggle} />);
    fireEvent.keyDown(screen.getAllByRole('treeitem')[0]!, { key: 'Enter' });
    fireEvent.keyDown(screen.getAllByRole('treeitem')[2]!, { key: ' ' });
    expect(onToggle).toHaveBeenNthCalledWith(1, 'a');
    expect(onToggle).toHaveBeenNthCalledWith(2, 'b');
  });

  it('selects a leaf node when Enter or Space is pressed', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(
      <VirtualTree
        flattenedNodes={nodes}
        rowHeight={20}
        onSelect={onSelect}
        onToggle={onToggle}
      />,
    );
    fireEvent.keyDown(screen.getAllByRole('treeitem')[1]!, { key: 'Enter' });
    fireEvent.keyDown(screen.getAllByRole('treeitem')[1]!, { key: ' ' });

    expect(onSelect).toHaveBeenNthCalledWith(1, 'a.1');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'a.1');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('moves focus with ArrowDown / ArrowUp', () => {
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={() => {}} />);
    fireEvent.keyDown(screen.getAllByRole('treeitem')[0]!, { key: 'ArrowDown' });
    let items = screen.getAllByRole('treeitem');
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    fireEvent.keyDown(items[1]!, { key: 'ArrowDown' });
    items = screen.getAllByRole('treeitem');
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    fireEvent.keyDown(items[2]!, { key: 'ArrowUp' });
    items = screen.getAllByRole('treeitem');
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('does not move focus past the boundaries', () => {
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={() => {}} />);
    fireEvent.keyDown(screen.getAllByRole('treeitem')[0]!, { key: 'ArrowUp' });
    expect(screen.getAllByRole('treeitem').map((i) => i.getAttribute('tabindex')))
      .toEqual(['0', '-1', '-1']);
  });

  it('moves focus with Home / End', () => {
    render(<VirtualTree flattenedNodes={nodes} rowHeight={20} onToggle={() => {}} />);
    fireEvent.keyDown(screen.getAllByRole('treeitem')[0]!, { key: 'End' });
    let items = screen.getAllByRole('treeitem');
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    fireEvent.keyDown(items[2]!, { key: 'Home' });
    items = screen.getAllByRole('treeitem');
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });
});
