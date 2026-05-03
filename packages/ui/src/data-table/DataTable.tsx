import { type DensityName } from '@firebase-desk/design-tokens';
import {
  type Column,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type Row,
  type Table,
  useReactTable,
} from '@tanstack/react-table';
import { type ReactNode, useMemo } from 'react';
import { cn } from '../cn.ts';
import { ContextMenu, ContextMenuTrigger } from '../context-menu/index.ts';
import { VirtualTable, type VirtualTableColumn } from '../VirtualTable.tsx';

export type DataTableColumn<TData> = ColumnDef<TData> & {
  readonly maxWidth?: number;
  readonly minWidth?: number;
  readonly width?: number;
};

export interface DataTableColumnLayout {
  readonly columnOrder: string[];
  readonly columnSizing: Record<string, number>;
}

export interface DataTableProps<TData> {
  readonly columns: ReadonlyArray<DataTableColumn<TData>>;
  readonly data: ReadonlyArray<TData>;
  readonly cellContextMenu?: (row: TData, columnId: string) => ReactNode | null;
  readonly columnLayout?: DataTableColumnLayout | null;
  readonly density?: DensityName | undefined;
  readonly emptyState?: ReactNode;
  readonly enableColumnReorder?: boolean;
  readonly enableColumnResize?: boolean;
  readonly getRowId?: (row: TData, index: number) => string;
  readonly onColumnLayoutChange?: (layout: DataTableColumnLayout) => void;
  readonly onRowClick?: (row: TData) => void;
  readonly onRowDoubleClick?: (row: TData) => void;
  readonly rowContextMenu?: (row: TData) => ReactNode | null;
  readonly rowClassName?: string | ((row: TData) => string | undefined);
  readonly rowHeight?: number;
  readonly scrollRestorationKey?: string | undefined;
  readonly selectedRowId?: string | null;
}

export function DataTable<TData>(
  {
    columnLayout,
    columns,
    data,
    cellContextMenu,
    density,
    emptyState,
    enableColumnReorder = false,
    enableColumnResize = false,
    getRowId,
    onColumnLayoutChange,
    onRowClick,
    onRowDoubleClick,
    rowContextMenu,
    rowClassName,
    rowHeight,
    scrollRestorationKey,
    selectedRowId,
  }: DataTableProps<TData>,
) {
  const sanitizedLayout = useMemo(
    () => sanitizeDataTableColumnLayout(columns, columnLayout),
    [columnLayout, columns],
  );
  const orderedColumns = useMemo(
    () => orderColumns(columns, sanitizedLayout.columnOrder),
    [columns, sanitizedLayout.columnOrder],
  );
  const table = useReactTable({
    columns: orderedColumns as ColumnDef<TData>[],
    data: data as TData[],
    getCoreRowModel: getCoreRowModel(),
    ...(getRowId ? { getRowId: (row: TData, index: number) => getRowId(row, index) } : {}),
  });

  const virtualColumns = useMemo<ReadonlyArray<VirtualTableColumn<Row<TData>>>>(
    () =>
      table.getAllLeafColumns().map((column, columnIndex) => {
        const columnDef = column.columnDef as DataTableColumn<TData>;
        const width = sanitizedLayout.columnSizing[column.id]
          ?? (enableColumnResize ? defaultColumnWidth(columnDef) : columnDef.width);
        const tableColumn = {
          id: column.id,
          header: renderHeader(table, column),
          ...(columnDef.maxWidth === undefined ? {} : { maxWidth: columnDef.maxWidth }),
          ...(columnDef.minWidth === undefined ? {} : { minWidth: columnDef.minWidth }),
          cell: (row: Row<TData>) => {
            const cell = row.getAllCells()[columnIndex];
            return cell ? flexRender(column.columnDef.cell, cell.getContext()) : null;
          },
        };
        return width === undefined ? tableColumn : { ...tableColumn, width };
      }),
    [enableColumnResize, sanitizedLayout.columnSizing, table],
  );

  const rows = table.getRowModel().rows;

  return (
    <VirtualTable
      columns={virtualColumns}
      density={density ?? 'compact'}
      emptyState={emptyState ?? 'No rows'}
      enableColumnReorder={enableColumnReorder}
      enableColumnResize={enableColumnResize}
      getRowKey={(row) => row.id}
      onColumnReorder={(activeColumnId, overColumnId) => {
        onColumnLayoutChange?.({
          ...sanitizedLayout,
          columnOrder: moveColumn(sanitizedLayout.columnOrder, activeColumnId, overColumnId),
        });
      }}
      onColumnResize={(columnId, width) => {
        onColumnLayoutChange?.({
          ...sanitizedLayout,
          columnSizing: { ...sanitizedLayout.columnSizing, [columnId]: width },
        });
      }}
      isRowSelected={(row) => selectedRowId === row.id}
      rowClassName={(row) =>
        cn(
          selectedRowId === row.id && 'bg-action-selected',
          typeof rowClassName === 'function' ? rowClassName(row.original) : rowClassName,
        )}
      {...(rowHeight === undefined ? {} : { rowHeight })}
      scrollRestorationKey={scrollRestorationKey}
      rows={rows}
      {...(cellContextMenu
        ? {
          cellWrapper: (
            cellElement: ReactNode,
            row: Row<TData>,
            column: VirtualTableColumn<Row<TData>>,
          ) => wrapCellContextMenu(cellElement, row, column.id, cellContextMenu),
        }
        : {})}
      {...(rowContextMenu
        ? {
          rowWrapper: (rowElement: ReactNode, row: Row<TData>) => (
            wrapRowContextMenu(rowElement, row, rowContextMenu)
          ),
        }
        : {})}
      {...(onRowClick ? { onRowClick: (row: Row<TData>) => onRowClick(row.original) } : {})}
      {...(onRowDoubleClick
        ? { onRowDoubleClick: (row: Row<TData>) => onRowDoubleClick(row.original) }
        : {})}
    />
  );
}

function wrapCellContextMenu<TData>(
  cellElement: ReactNode,
  row: Row<TData>,
  columnId: string,
  cellContextMenu: (row: TData, columnId: string) => ReactNode | null,
): ReactNode {
  const content = cellContextMenu(row.original, columnId);
  if (!content) return cellElement;
  return (
    <ContextMenu key={`${row.id}:${columnId}`}>
      <ContextMenuTrigger asChild>{cellElement}</ContextMenuTrigger>
      {content}
    </ContextMenu>
  );
}

function wrapRowContextMenu<TData>(
  rowElement: ReactNode,
  row: Row<TData>,
  rowContextMenu: (row: TData) => ReactNode | null,
): ReactNode {
  const content = rowContextMenu(row.original);
  if (!content) return rowElement;
  return (
    <ContextMenu key={row.id}>
      <ContextMenuTrigger asChild>{rowElement}</ContextMenuTrigger>
      {content}
    </ContextMenu>
  );
}

function renderHeader<TData>(table: Table<TData>, column: Column<TData>): ReactNode {
  const header = table.getHeaderGroups()[0]?.headers.find((item) => item.column.id === column.id);
  if (header) return flexRender(column.columnDef.header, header.getContext());
  return typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id;
}

export function sanitizeDataTableColumnLayout<TData>(
  columns: ReadonlyArray<DataTableColumn<TData>>,
  layout: DataTableColumnLayout | null | undefined,
): DataTableColumnLayout {
  const defaultOrder = columns.map((column) => column.id).filter((id): id is string =>
    typeof id === 'string' && id.length > 0
  );
  const knownColumns = new Set(defaultOrder);
  const order = layout?.columnOrder.filter((id) => knownColumns.has(id)) ?? [];
  for (const id of defaultOrder) {
    if (!order.includes(id)) insertMissingColumn(order, id, defaultOrder);
  }
  const columnSizing: Record<string, number> = {};
  for (const column of columns) {
    if (!column.id || typeof column.id !== 'string') continue;
    const savedWidth = layout?.columnSizing[column.id];
    if (savedWidth === undefined) continue;
    columnSizing[column.id] = clampColumnWidth(savedWidth, column);
  }
  return { columnOrder: order, columnSizing };
}

function orderColumns<TData>(
  columns: ReadonlyArray<DataTableColumn<TData>>,
  order: ReadonlyArray<string>,
): ReadonlyArray<DataTableColumn<TData>> {
  const columnById = new Map(columns.map((column) => [column.id, column]));
  return order.flatMap((id) => {
    const column = columnById.get(id);
    return column ? [column] : [];
  });
}

function insertMissingColumn(order: string[], id: string, defaultOrder: ReadonlyArray<string>) {
  const defaultIndex = defaultOrder.indexOf(id);
  for (let index = defaultIndex - 1; index >= 0; index -= 1) {
    const previousDefaultId = defaultOrder[index];
    const previousIndex = previousDefaultId ? order.indexOf(previousDefaultId) : -1;
    if (previousIndex >= 0) {
      order.splice(previousIndex + 1, 0, id);
      return;
    }
  }
  for (let index = defaultIndex + 1; index < defaultOrder.length; index += 1) {
    const nextDefaultId = defaultOrder[index];
    const nextIndex = nextDefaultId ? order.indexOf(nextDefaultId) : -1;
    if (nextIndex >= 0) {
      order.splice(nextIndex, 0, id);
      return;
    }
  }
  order.push(id);
}

function moveColumn(
  order: ReadonlyArray<string>,
  activeColumnId: string,
  overColumnId: string,
): string[] {
  const next = order.filter((id) => id !== activeColumnId);
  const overIndex = next.indexOf(overColumnId);
  if (overIndex < 0) return [...order];
  next.splice(overIndex, 0, activeColumnId);
  return next;
}

function defaultColumnWidth<TData>(column: DataTableColumn<TData>): number {
  return clampColumnWidth(column.width ?? 160, column);
}

function clampColumnWidth<TData>(width: number, column: DataTableColumn<TData>): number {
  return Math.min(column.maxWidth ?? 640, Math.max(column.minWidth ?? 72, Math.round(width)));
}
