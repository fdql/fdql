import type { DensityName } from '@firebase-desk/design-tokens';
import type { FirestoreDocumentResult, SettingsRepository } from '@firebase-desk/repo-contracts';
import { Button, DataTable, type DataTableColumn, EmptyState } from '@firebase-desk/ui';
import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { DocumentContextMenuContent, FieldContextMenuContent } from './FieldContextMenu.tsx';
import { type FieldEditTarget } from './fieldEditModel.ts';
import { FirestoreValueCell } from './FirestoreValueCell.tsx';
import { fieldCatalogForRows, type SubcollectionLoadState } from './resultModel.tsx';
import { useResultTableLayout } from './resultTableLayout.ts';
import { renderSubcollectionButtons } from './SubcollectionControls.tsx';

export interface ResultTableProps {
  readonly density?: DensityName | undefined;
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly onDeleteDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
  readonly onEditDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
  readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
  readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
  readonly onLoadMore: () => void;
  readonly onLoadSubcollections?: ((documentPath: string) => Promise<void> | void) | undefined;
  readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
  readonly onSelectDocument?: ((documentPath: string) => void) | undefined;
  readonly onSettingsError?: ((message: string) => void) | undefined;
  readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
  readonly queryPath: string;
  readonly scrollRestorationKey?: string | undefined;
  readonly rows: ReadonlyArray<FirestoreDocumentResult>;
  readonly selectedDocumentPath: string | null;
  readonly settings?: SettingsRepository | undefined;
  readonly subcollectionStates: Readonly<Record<string, SubcollectionLoadState>>;
}

type ResultTableRow = { readonly kind: 'document'; readonly document: FirestoreDocumentResult; };

const MAX_RESULT_TABLE_FIELD_COLUMNS = 200;
const FIELD_OVERFLOW_COLUMN_ID = '__field_overflow__';

export function ResultTable(
  {
    density,
    hasMore,
    isFetchingMore,
    onDeleteDocument,
    onEditDocument,
    onDeleteField,
    onEditField,
    onLoadMore,
    onLoadSubcollections,
    onOpenDocumentInNewTab,
    onSelectDocument,
    onSettingsError,
    onSetFieldNull,
    queryPath,
    scrollRestorationKey,
    rows,
    selectedDocumentPath,
    settings,
    subcollectionStates,
  }: ResultTableProps,
) {
  const fieldCatalog = useMemo(() => fieldCatalogForRows(rows), [rows]);
  const fieldColumns = useMemo(
    () => fieldCatalog.slice(0, MAX_RESULT_TABLE_FIELD_COLUMNS).map((field) => field.field),
    [fieldCatalog],
  );
  const hiddenFieldColumnCount = Math.max(0, fieldCatalog.length - fieldColumns.length);
  const visibleFields = useMemo(
    () => new Set(fieldColumns),
    [fieldColumns],
  );
  const tableRows = useMemo<ReadonlyArray<ResultTableRow>>(
    () => rows.map((document) => ({ kind: 'document', document })),
    [rows],
  );
  const showSubcollections = rows.some((row) =>
    row.hasSubcollections || (row.subcollections?.length ?? 0) > 0
  );
  const columns = useMemo<ReadonlyArray<DataTableColumn<ResultTableRow>>>(
    () => [
      {
        id: 'id',
        header: 'Document ID',
        width: 180,
        minWidth: 120,
        cell: ({ row }) => (
          <code
            aria-label={`Document ID ${row.original.document.id}`}
            className='select-text'
            title={row.original.document.id}
          >
            {row.original.document.id}
          </code>
        ),
      },
      ...fieldColumns.map((field) => ({
        id: field,
        header: () => <code className='select-text'>{field}</code>,
        width: 160,
        minWidth: 96,
        cell: ({ row }) => {
          const value = row.original.document.data[field];
          return field in row.original.document.data
            ? <FirestoreValueCell value={value} />
            : '';
        },
      } satisfies DataTableColumn<ResultTableRow>)),
      ...(hiddenFieldColumnCount > 0
        ? [
          {
            id: FIELD_OVERFLOW_COLUMN_ID,
            header: `+${hiddenFieldColumnCount} fields`,
            width: 180,
            minWidth: 140,
            cell: ({ row }) => {
              const hiddenCount = Object.keys(row.original.document.data)
                .filter((field) => !visibleFields.has(field)).length;
              return hiddenCount > 0 ? `${hiddenCount} fields hidden` : '';
            },
          } satisfies DataTableColumn<ResultTableRow>,
        ]
        : []),
      ...(showSubcollections
        ? [
          {
            id: 'subcollections',
            header: 'Subcollections',
            width: 420,
            minWidth: 180,
            maxWidth: 720,
            cell: ({ row }) =>
              renderSubcollectionButtons(
                row.original.document,
                onOpenDocumentInNewTab,
                subcollectionStates[row.original.document.path],
                onLoadSubcollections,
              ),
          } satisfies DataTableColumn<ResultTableRow>,
        ]
        : []),
    ],
    [
      fieldColumns,
      hiddenFieldColumnCount,
      onDeleteField,
      onEditField,
      onLoadSubcollections,
      onOpenDocumentInNewTab,
      onSetFieldNull,
      showSubcollections,
      subcollectionStates,
      visibleFields,
    ],
  );
  const { hasSavedLayout, layout, resetLayout, saveLayout } = useResultTableLayout({
    columns,
    onSettingsError,
    queryPath,
    settings,
  });
  const showFooter = hasMore || hasSavedLayout;

  return (
    <div className='grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]'>
      <DataTable
        columnLayout={layout}
        columns={columns}
        data={tableRows}
        density={density}
        emptyState={<EmptyState title='No documents' />}
        enableColumnReorder
        enableColumnResize
        getRowId={(row) => row.document.path}
        onColumnLayoutChange={saveLayout}
        scrollRestorationKey={scrollRestorationKey}
        cellContextMenu={(row, columnId) =>
          renderCellContextMenu({
            columnId,
            document: row.document,
            onDeleteDocument,
            onDeleteField,
            onEditField,
            onOpenDocumentInNewTab,
            onSetFieldNull,
          })}
        rowClassName={(row) =>
          selectedDocumentPath === row.document.path ? 'bg-action-selected' : undefined}
        selectedRowId={selectedDocumentPath}
        {...(onSelectDocument
          ? { onRowClick: (row: ResultTableRow) => onSelectDocument(row.document.path) }
          : {})}
        {...(onEditDocument
          ? { onRowDoubleClick: (row: ResultTableRow) => onEditDocument(row.document) }
          : {})}
      />
      {showFooter
        ? (
          <div className='flex items-center gap-2 border-t border-border-subtle bg-bg-panel px-3 py-2'>
            {hasMore
              ? (
                <Button disabled={isFetchingMore} variant='secondary' onClick={onLoadMore}>
                  {isFetchingMore ? 'Loading' : 'Load more'}
                </Button>
              )
              : null}
            {hasSavedLayout
              ? (
                <Button className='gap-1.5' size='xs' variant='secondary' onClick={resetLayout}>
                  <RotateCcw size={13} aria-hidden='true' />
                  Reset table layout
                </Button>
              )
              : null}
          </div>
        )
        : null}
    </div>
  );
}

function renderCellContextMenu(
  {
    columnId,
    document,
    onDeleteDocument,
    onDeleteField,
    onEditField,
    onOpenDocumentInNewTab,
    onSetFieldNull,
  }: {
    readonly columnId: string;
    readonly document: FirestoreDocumentResult;
    readonly onDeleteDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
    readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
    readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
    readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
    readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
  },
) {
  if (columnId in document.data) {
    return (
      <FieldContextMenuContent
        document={document}
        fieldPath={[columnId]}
        value={document.data[columnId]}
        onDeleteDocument={onDeleteDocument}
        onDeleteField={onDeleteField}
        onEditField={onEditField}
        onOpenDocumentInNewTab={onOpenDocumentInNewTab}
        onSetFieldNull={onSetFieldNull}
      />
    );
  }
  if (!onOpenDocumentInNewTab && !onDeleteDocument) return null;
  return (
    <DocumentContextMenuContent
      document={document}
      onDeleteDocument={onDeleteDocument}
      onOpenDocumentInNewTab={onOpenDocumentInNewTab}
    />
  );
}
