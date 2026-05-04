import { density as densityTokens, type DensityName } from '@firebase-desk/design-tokens';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type Key, type ReactNode, useLayoutEffect, useRef } from 'react';
import { cn } from './cn.ts';
import { useScrollRestoration } from './scroll-restoration.ts';
import { visibleVirtualRows } from './virtualRows.ts';

export interface VirtualListProps<T> {
  readonly items: ReadonlyArray<T>;
  readonly className?: string;
  readonly density?: DensityName | undefined;
  readonly estimateSize?: (index: number) => number;
  readonly getItemKey?: (item: T, index: number) => Key;
  readonly itemClassName?: string | ((item: T, index: number) => string | undefined);
  readonly overscan?: number;
  readonly renderItem: (item: T, index: number) => ReactNode;
  readonly scrollRestorationKey?: string | undefined;
  readonly scrollToIndex?: number | null | undefined;
}

export function VirtualList<T>(
  {
    className,
    density = 'compact',
    estimateSize,
    getItemKey,
    itemClassName,
    items,
    overscan = 8,
    renderItem,
    scrollRestorationKey,
    scrollToIndex,
  }: VirtualListProps<T>,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const lastScrollToIndexRef = useRef<number | null>(null);
  const rowHeight = densityTokens[density].rowHeight;
  const estimateRowSize = estimateSize ?? (() => rowHeight);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowSize,
    initialRect: {
      height: rowHeight * Math.min(Math.max(items.length, 1), 12),
      width: 0,
    },
    overscan,
  });
  const onScroll = useScrollRestoration(scrollRestorationKey, parentRef);
  useLayoutEffect(() => {
    if (scrollToIndex === null || scrollToIndex === undefined) return;
    if (lastScrollToIndexRef.current === scrollToIndex) return;
    lastScrollToIndexRef.current = scrollToIndex;
    (
      virtualizer as {
        readonly scrollToIndex?: (
          index: number,
          options?: { readonly align?: 'auto' | 'center' | 'end' | 'start'; },
        ) => void;
      }
    ).scrollToIndex?.(scrollToIndex, { align: 'auto' });
  }, [scrollToIndex, virtualizer]);
  const virtualRows = visibleVirtualRows(
    virtualizer.getVirtualItems(),
    items.length,
    estimateRowSize(0),
  );

  return (
    <div ref={parentRef} className={cn('h-full overflow-auto', className)} onScroll={onScroll}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualRows.map((row) => {
          const item = items[row.index];
          if (item === undefined) return null;
          return (
            <div
              key={getItemKey?.(item, row.index) ?? row.key}
              className={typeof itemClassName === 'function'
                ? itemClassName(item, row.index)
                : itemClassName}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
              }}
            >
              {renderItem(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
