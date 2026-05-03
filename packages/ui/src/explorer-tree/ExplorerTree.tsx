import { density as densityTokens, type DensityName } from '@firebase-desk/design-tokens';
import { ChevronRight } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../cn.ts';
import { ContextMenu, ContextMenuTrigger } from '../context-menu/index.ts';
import { VirtualList } from '../VirtualList.tsx';

export interface ExplorerTreeRowModel {
  readonly id: string;
  readonly icon?: ReactNode;
  readonly label: ReactNode;
  readonly level: number;
  readonly meta?: ReactNode;
  readonly value?: ReactNode;
  readonly expanded?: boolean;
  readonly hasChildren?: boolean;
}

export interface ExplorerTreeProps<TNode extends ExplorerTreeRowModel = ExplorerTreeRowModel> {
  readonly className?: string;
  readonly contextMenu?: ((node: TNode) => ReactNode | null) | undefined;
  readonly density?: DensityName | undefined;
  readonly estimateSize?: (index: number) => number;
  readonly onOpen?: ((id: string) => void) | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
  readonly onToggle: (id: string) => void;
  readonly renderAction?: ((node: TNode) => ReactNode) | undefined;
  readonly rows: ReadonlyArray<TNode>;
  readonly scrollRestorationKey?: string | undefined;
}

export function ExplorerTree<TNode extends ExplorerTreeRowModel = ExplorerTreeRowModel>(
  {
    className,
    contextMenu,
    density,
    estimateSize,
    onOpen,
    onSelect,
    onToggle,
    renderAction,
    rows,
    scrollRestorationKey,
  }: ExplorerTreeProps<TNode>,
) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [scrollToIndex, setScrollToIndex] = useState<number | null>(null);
  const clampedFocusedIndex = rows.length === 0 ? 0 : Math.min(focusedIndex, rows.length - 1);
  const resolvedDensity = density ?? 'compact';
  const rowHeight = densityTokens[resolvedDensity].treeRowHeight;
  const estimateRowSize = estimateSize ?? (() => rowHeight);

  useEffect(() => {
    setFocusedIndex((current) => {
      if (rows.length === 0) return 0;
      return Math.min(Math.max(current, 0), rows.length - 1);
    });
  }, [rows.length]);

  const moveFocus = useCallback(
    (index: number) => {
      const next = rows.length === 0 ? 0 : Math.min(Math.max(index, 0), rows.length - 1);
      setFocusedIndex(next);
      setScrollToIndex(next);
    },
    [rows.length],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number, node: TNode) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveFocus(index + 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveFocus(index - 1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        moveFocus(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        moveFocus(rows.length - 1);
        return;
      }
      if (event.key === 'ArrowRight' && node.hasChildren && !node.expanded) {
        event.preventDefault();
        onSelect?.(node.id);
        onToggle(node.id);
        return;
      }
      if (event.key === 'ArrowLeft' && node.hasChildren && node.expanded) {
        event.preventDefault();
        onSelect?.(node.id);
        onToggle(node.id);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect?.(node.id);
        if (node.hasChildren) onToggle(node.id);
        else onOpen?.(node.id);
      }
    },
    [moveFocus, onOpen, onSelect, onToggle, rows.length],
  );
  return (
    <div className={cn('h-full min-w-[680px] font-mono text-xs', className)} role='tree'>
      <VirtualList
        getItemKey={(item) => item.id}
        items={rows}
        renderItem={(item, index) => (
          <ExplorerTreeRow
            contextMenu={contextMenu}
            focused={index === clampedFocusedIndex}
            index={index}
            node={item}
            renderAction={renderAction}
            rowHeight={rowHeight}
            setFocusedIndex={setFocusedIndex}
            onKeyDown={handleKeyDown}
            onOpen={onOpen}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        )}
        density={resolvedDensity}
        estimateSize={estimateRowSize}
        scrollRestorationKey={scrollRestorationKey}
        scrollToIndex={scrollToIndex}
      />
    </div>
  );
}

function ExplorerTreeRow<TNode extends ExplorerTreeRowModel>(
  {
    contextMenu,
    focused,
    index,
    node,
    renderAction,
    rowHeight,
    setFocusedIndex,
    onKeyDown,
    onOpen,
    onSelect,
    onToggle,
  }: {
    readonly contextMenu?: ((node: TNode) => ReactNode | null) | undefined;
    readonly focused: boolean;
    readonly index: number;
    readonly node: TNode;
    readonly renderAction?: ((node: TNode) => ReactNode) | undefined;
    readonly rowHeight: number;
    readonly setFocusedIndex: (index: number) => void;
    readonly onKeyDown: (
      event: KeyboardEvent<HTMLDivElement>,
      index: number,
      node: TNode,
    ) => void;
    readonly onOpen?: ((id: string) => void) | undefined;
    readonly onSelect?: ((id: string) => void) | undefined;
    readonly onToggle: (id: string) => void;
  },
) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rowRef.current;
    if (!element || !focused) return;
    const activeElement = element.ownerDocument.activeElement;
    if (activeElement === element || element.contains(activeElement)) return;
    if (element.parentElement?.contains(activeElement)) element.focus();
  }, [focused]);

  const row = (
    <div
      className='grid grid-cols-[16px_16px_minmax(140px,0.8fr)_minmax(160px,1fr)_112px_auto] items-center gap-2 border-b border-border-subtle pr-3 text-text-primary transition-colors hover:bg-action-ghost-hover'
      role='treeitem'
      tabIndex={focused ? 0 : -1}
      style={{ minHeight: rowHeight, paddingLeft: 12 + node.level * 22 }}
      aria-expanded={node.hasChildren ? Boolean(node.expanded) : undefined}
      aria-level={node.level + 1}
      ref={rowRef}
      onClick={(event) => {
        if (event.detail > 1) return;
        setFocusedIndex(index);
        onSelect?.(node.id);
        if (node.hasChildren) onToggle(node.id);
      }}
      onDoubleClick={(event) => {
        if (!onOpen) return;
        event.preventDefault();
        onOpen(node.id);
      }}
      onKeyDown={(event) => onKeyDown(event, index, node)}
    >
      <span>
        {node.hasChildren
          ? (
            <ChevronRight
              size={13}
              aria-hidden='true'
              className={cn('text-text-muted transition-transform', node.expanded && 'rotate-90')}
            />
          )
          : null}
      </span>
      <span className='text-action-primary'>{node.icon}</span>
      <span className='min-w-0 truncate font-medium'>{node.label}</span>
      <span className='min-w-0 truncate text-text-muted'>{node.value ?? ''}</span>
      <code className='text-text-muted'>{node.meta ?? ''}</code>
      <span
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {renderAction?.(node)}
      </span>
    </div>
  );
  const content = contextMenu?.(node);
  if (!content) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      {content}
    </ContextMenu>
  );
}
