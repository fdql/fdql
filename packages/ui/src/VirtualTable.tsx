import { density as densityTokens, type DensityName } from '@firebase-desk/design-tokens';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Fragment,
  type Key,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from './cn.ts';
import { useScrollRestoration } from './scroll-restoration.ts';
import { visibleVirtualRows } from './virtualRows.ts';

export interface VirtualTableColumn<T> {
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (row: T) => ReactNode;
  readonly maxWidth?: number;
  readonly minWidth?: number;
  readonly width?: number;
}

export interface VirtualTableProps<T> {
  readonly rows: ReadonlyArray<T>;
  readonly columns: ReadonlyArray<VirtualTableColumn<T>>;
  readonly className?: string;
  readonly density?: DensityName | undefined;
  readonly emptyState?: ReactNode;
  readonly enableColumnReorder?: boolean;
  readonly enableColumnResize?: boolean;
  readonly getRowKey?: (row: T, index: number) => Key;
  readonly headerClassName?: string;
  readonly isRowSelected?: (row: T, index: number) => boolean;
  readonly onColumnReorder?: (activeColumnId: string, overColumnId: string) => void;
  readonly onColumnResize?: (columnId: string, width: number) => void;
  readonly onRowClick?: (row: T) => void;
  readonly onRowDoubleClick?: (row: T) => void;
  readonly cellWrapper?: (
    cellElement: ReactNode,
    row: T,
    column: VirtualTableColumn<T>,
    index: number,
  ) => ReactNode;
  readonly rowHeight?: number;
  readonly rowClassName?: string | ((row: T) => string | undefined);
  readonly rowWrapper?: (rowElement: ReactNode, row: T, index: number) => ReactNode;
  readonly scrollRestorationKey?: string | undefined;
}

export function VirtualTable<T>(
  {
    className,
    columns,
    density = 'compact',
    emptyState,
    enableColumnReorder = false,
    enableColumnResize = false,
    getRowKey,
    headerClassName,
    isRowSelected,
    cellWrapper,
    onColumnReorder,
    onColumnResize,
    onRowClick,
    onRowDoubleClick,
    rowClassName,
    rowHeight,
    rows,
    rowWrapper,
    scrollRestorationKey,
  }: VirtualTableProps<T>,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const lastPrimaryClickKeyRef = useRef<Key | null>(null);
  const pendingKeyboardFocusIndexRef = useRef<number | null>(null);
  const [isResizingColumn, setIsResizingColumn] = useState(false);
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const resolvedRowHeight = rowHeight ?? densityTokens[density].rowHeight;
  const tableWidth = tableContentWidth(columns);
  const tableWidthStyle = tableWidth === undefined
    ? { minWidth: '100%' }
    : { width: tableWidth, minWidth: '100%' };
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => resolvedRowHeight,
    initialRect: {
      height: resolvedRowHeight * Math.min(Math.max(rows.length, 1), 12),
      width: tableWidth ?? 0,
    },
    overscan: 12,
  });
  const onScroll = useScrollRestoration(scrollRestorationKey, parentRef);
  const virtualRows = visibleVirtualRows(
    virtualizer.getVirtualItems(),
    rows.length,
    resolvedRowHeight,
  );
  const clampedFocusedRowIndex = clampRowIndex(focusedRowIndex, rows.length);

  useEffect(() => {
    setFocusedRowIndex((current) => clampRowIndex(current, rows.length));
  }, [rows.length]);

  useLayoutEffect(() => {
    const rowIndex = pendingKeyboardFocusIndexRef.current;
    if (rowIndex === null) return;
    const focused = focusRow(parentRef.current, rowIndex);
    if (focused) pendingKeyboardFocusIndexRef.current = null;
  }, [clampedFocusedRowIndex, virtualRows]);

  function moveKeyboardFocus(rowIndex: number): void {
    const nextIndex = clampRowIndex(rowIndex, rows.length);
    pendingKeyboardFocusIndexRef.current = nextIndex;
    setFocusedRowIndex(nextIndex);
    (
      virtualizer as {
        readonly scrollToIndex?: (
          index: number,
          options?: { readonly align?: 'auto' | 'center' | 'end' | 'start'; },
        ) => void;
      }
    ).scrollToIndex?.(nextIndex, { align: 'auto' });
    if (focusRow(parentRef.current, nextIndex)) pendingKeyboardFocusIndexRef.current = null;
  }

  return (
    <div
      ref={parentRef}
      aria-colcount={columns.length}
      aria-rowcount={rows.length + 1}
      className={cn('h-full overflow-auto', className)}
      role='grid'
      onScroll={onScroll}
    >
      <div
        aria-rowindex={1}
        className={cn(
          'sticky top-0 z-10 flex border-b border-border-subtle bg-bg-elevated text-xs font-semibold text-text-secondary shadow-sm',
          headerClassName,
        )}
        role='row'
        style={tableWidthStyle}
      >
        {columns.map((c, columnIndex) => (
          <div
            key={c.id}
            aria-colindex={columnIndex + 1}
            className={cn(
              'relative flex min-w-0 items-center border-r border-border-subtle px-2 py-1 last:border-r-0',
              enableColumnReorder && !isResizingColumn && 'cursor-grab active:cursor-grabbing',
              isResizingColumn && 'cursor-col-resize',
            )}
            draggable={enableColumnReorder && !isResizingColumn}
            role='columnheader'
            style={{ flex: columnFlex(c) }}
            onDragOver={(event) => {
              if (!enableColumnReorder) return;
              event.preventDefault();
            }}
            onDragStart={(event) => {
              if (!enableColumnReorder) return;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', c.id);
            }}
            onDrop={(event) => {
              if (!enableColumnReorder) return;
              event.preventDefault();
              const activeColumnId = event.dataTransfer.getData('text/plain');
              if (activeColumnId && activeColumnId !== c.id) {
                onColumnReorder?.(activeColumnId, c.id);
              }
            }}
          >
            <span className='min-w-0 truncate'>{c.header}</span>
            {enableColumnResize && c.width !== undefined
              ? (
                <ColumnResizeHandle
                  column={c}
                  onResizeEnd={() => setIsResizingColumn(false)}
                  onResizeStart={() => setIsResizingColumn(true)}
                  onResize={(width) => onColumnResize?.(c.id, width)}
                />
              )
              : null}
          </div>
        ))}
      </div>
      <div
        className={cn(rows.length === 0 && 'grid place-items-center')}
        role='rowgroup'
        style={{
          minHeight: rows.length === 0 ? 'calc(100% - 28px)' : undefined,
          height: rows.length === 0 ? undefined : virtualizer.getTotalSize(),
          position: 'relative',
          ...tableWidthStyle,
        }}
      >
        {rows.length === 0 ? emptyState : null}
        {virtualRows.map((row) => {
          const item = rows[row.index];
          if (item === undefined) return null;
          const rowKey = getRowKey?.(item, row.index) ?? row.key;
          const doubleClickHandler = onRowDoubleClick ?? onRowClick;
          const rowElement = (
            <div
              aria-rowindex={row.index + 2}
              aria-selected={isRowSelected?.(item, row.index) ?? undefined}
              className={cn(
                'flex border-b border-border-subtle text-sm text-text-primary hover:bg-action-ghost-hover',
                'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-border-focus)]',
                onRowClick && 'cursor-pointer',
                typeof rowClassName === 'function' ? rowClassName(item) : rowClassName,
              )}
              data-virtual-table-row-index={row.index}
              role='row'
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
                display: 'flex',
                height: resolvedRowHeight,
              }}
              tabIndex={onRowClick && clampedFocusedRowIndex === row.index ? 0 : -1}
              onFocus={() => setFocusedRowIndex(row.index)}
              onClick={(event) => {
                if (event.detail > 1) return;
                setFocusedRowIndex(row.index);
                lastPrimaryClickKeyRef.current = rowKey;
                onRowClick?.(item);
              }}
              onDoubleClick={(event) => {
                if (!doubleClickHandler) return;
                if (!onRowDoubleClick && lastPrimaryClickKeyRef.current === rowKey) {
                  lastPrimaryClickKeyRef.current = null;
                  return;
                }
                event.preventDefault();
                lastPrimaryClickKeyRef.current = null;
                doubleClickHandler(item);
              }}
              onKeyDown={(event) => {
                handleRowKeyDown({
                  event,
                  onRowClick,
                  parent: parentRef.current,
                  row: item,
                  rowIndex: row.index,
                  rowCount: rows.length,
                  moveFocus: moveKeyboardFocus,
                });
              }}
            >
              {columns.map((c, columnIndex) => {
                const cellElement = (
                  <div
                    aria-colindex={columnIndex + 1}
                    className='min-w-0 truncate border-r border-border-subtle px-2 py-1 last:border-r-0'
                    role='gridcell'
                    style={{ flex: columnFlex(c) }}
                  >
                    {c.cell(item)}
                  </div>
                );
                const wrapped = cellWrapper
                  ? cellWrapper(cellElement, item, c, row.index)
                  : cellElement;
                return <Fragment key={c.id}>{wrapped}</Fragment>;
              })}
            </div>
          );
          const wrapped = rowWrapper ? rowWrapper(rowElement, item, row.index) : rowElement;
          return <Fragment key={rowKey}>{wrapped}</Fragment>;
        })}
      </div>
    </div>
  );
}

function handleRowKeyDown<T>(
  {
    event,
    onRowClick,
    parent,
    row,
    rowCount,
    rowIndex,
    moveFocus,
  }: {
    readonly event: KeyboardEvent<HTMLDivElement>;
    readonly onRowClick?: ((row: T) => void) | undefined;
    readonly parent: HTMLElement | null;
    readonly row: T;
    readonly rowCount: number;
    readonly rowIndex: number;
    readonly moveFocus: (rowIndex: number) => void;
  },
): void {
  if ((event.key === 'Enter' || event.key === ' ') && onRowClick) {
    event.preventDefault();
    onRowClick(row);
    return;
  }

  const nextIndex = nextKeyboardRowIndex(event.key, rowIndex, rowCount);
  if (nextIndex === null) return;
  event.preventDefault();
  if (!focusRow(parent, nextIndex)) moveFocus(nextIndex);
}

function nextKeyboardRowIndex(key: string, rowIndex: number, rowCount: number): number | null {
  if (key === 'ArrowDown') return Math.min(rowCount - 1, rowIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, rowIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return Math.max(0, rowCount - 1);
  return null;
}

function focusRow(parent: HTMLElement | null, rowIndex: number): boolean {
  const selector = `[data-virtual-table-row-index="${String(rowIndex)}"]`;
  const row = parent?.querySelector<HTMLElement>(selector);
  if (!row) return false;
  row.focus();
  return true;
}

function clampRowIndex(index: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.max(0, Math.min(index, rowCount - 1));
}

function ColumnResizeHandle<T>(
  { column, onResize, onResizeEnd, onResizeStart }: {
    readonly column: VirtualTableColumn<T>;
    readonly onResize: (width: number) => void;
    readonly onResizeEnd: () => void;
    readonly onResizeStart: () => void;
  },
) {
  function startResize(event: MouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    onResizeStart();
    const startX = event.clientX;
    const startWidth = column.width ?? 160;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      onResize(clampWidth(startWidth + moveEvent.clientX - startX, column));
    };
    const onUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onResizeEnd();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <span
      aria-label={`Resize ${columnResizeLabel(column)}`}
      className='absolute -right-1 bottom-0 top-0 z-20 w-2 cursor-col-resize before:absolute before:bottom-1 before:left-1/2 before:top-1 before:w-px before:-translate-x-1/2 before:bg-border-subtle hover:before:bg-border-focus'
      role='separator'
      tabIndex={-1}
      onMouseDown={startResize}
    />
  );
}

function columnFlex<T>(column: VirtualTableColumn<T>): string | number {
  return column.width === undefined ? 1 : `0 0 ${column.width}px`;
}

function columnResizeLabel<T>(column: VirtualTableColumn<T>): string {
  if (typeof column.header === 'string' || typeof column.header === 'number') {
    return String(column.header);
  }
  return column.id;
}

function tableContentWidth<T>(columns: ReadonlyArray<VirtualTableColumn<T>>): number | undefined {
  if (columns.some((column) => column.width === undefined)) return undefined;
  return columns.reduce((total, column) => total + (column.width ?? 0), 0);
}

function clampWidth<T>(width: number, column: VirtualTableColumn<T>): number {
  return Math.min(column.maxWidth ?? 640, Math.max(column.minWidth ?? 72, Math.round(width)));
}
