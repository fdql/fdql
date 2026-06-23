import type { FirestoreDocumentResult } from '@firebase-desk/repo-contracts';
import {
  Badge,
  DetailRow,
  EmptyState,
  IconButton,
  InspectorSection,
  Panel,
  PanelBody,
  PanelHeader,
} from '@firebase-desk/ui';
import {
  Braces,
  Edit3,
  FileJson,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Table2,
  Trash2,
} from 'lucide-react';
import { useMemo } from 'react';
import { type FieldEditTarget } from './fieldEditModel.ts';
import type {
  FirestoreInspectorSectionId,
  FirestoreInspectorSectionState,
} from './inspectorState.ts';
import { NestedValueTree } from './NestedValueTree.tsx';
import {
  fieldCatalogForRows,
  type FieldCatalogItem,
  MAX_SUBCOLLECTION_CHIPS,
} from './resultModel.tsx';
import { SubcollectionChipList } from './SubcollectionControls.tsx';
import type { FirestoreResultView } from './types.ts';

export interface ResultContextPanelProps {
  readonly onDeleteDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
  readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
  readonly onCollapse: () => void;
  readonly onEditDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
  readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
  readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
  readonly onSetFieldValue?: ((target: FieldEditTarget, value: unknown) => void) | undefined;
  readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
  readonly onSectionOpenChange?:
    | ((section: FirestoreInspectorSectionId, open: boolean) => void)
    | undefined;
  readonly onSelectionPreviewExpandedPathsChange?:
    | ((expandedPaths: ReadonlySet<string>) => void)
    | undefined;
  readonly resultView: FirestoreResultView;
  readonly rows: ReadonlyArray<FirestoreDocumentResult>;
  readonly sections?: FirestoreInspectorSectionState | undefined;
  readonly selectionPreviewExpandedPaths?: ReadonlySet<string> | undefined;
  readonly selectedDocument: FirestoreDocumentResult | null;
}

export function ResultContextPanel(
  {
    onCollapse,
    onDeleteDocument,
    onDeleteField,
    onEditDocument,
    onEditField,
    onOpenDocumentInNewTab,
    onSectionOpenChange,
    onSelectionPreviewExpandedPathsChange,
    onSetFieldValue,
    onSetFieldNull,
    resultView,
    rows,
    sections,
    selectionPreviewExpandedPaths,
    selectedDocument,
  }: ResultContextPanelProps,
) {
  const fieldCatalog = useMemo(() => fieldCatalogForRows(rows), [rows]);
  const showSelectionPreview = resultView === 'table' || resultView === 'tree';

  return (
    <Panel className='grid min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
      <PanelHeader
        actions={
          <span className='flex items-center gap-1'>
            <Badge>{rows.length} docs</Badge>
            <IconButton
              icon={<PanelRightClose size={14} aria-hidden='true' />}
              label='Collapse result overview'
              size='xs'
              variant='ghost'
              onClick={onCollapse}
            />
          </span>
        }
      >
        <span className='flex min-w-0 items-center gap-2'>
          <Table2 size={15} aria-hidden='true' />
          <span className='truncate'>Result overview</span>
        </span>
      </PanelHeader>
      <PanelBody className='min-h-0 p-0'>
        {showSelectionPreview
          ? (
            <InspectorSection
              defaultOpen
              icon={<FileText size={14} aria-hidden='true' />}
              meta={selectedDocument?.id ?? 'none'}
              open={sections?.selectionPreview}
              title='Selection preview'
              onOpenChange={(open) => onSectionOpenChange?.('selectionPreview', open)}
            >
              <SelectionPreview
                document={selectedDocument}
                onDelete={onDeleteDocument && selectedDocument
                  ? () => onDeleteDocument(selectedDocument)
                  : undefined}
                onEdit={onEditDocument && selectedDocument
                  ? () => onEditDocument(selectedDocument)
                  : undefined}
                onDeleteField={onDeleteField}
                onEditField={onEditField}
                onOpenDocumentInNewTab={onOpenDocumentInNewTab}
                expandedPaths={selectionPreviewExpandedPaths}
                onExpandedPathsChange={onSelectionPreviewExpandedPathsChange}
                onSetFieldValue={onSetFieldValue}
                onSetFieldNull={onSetFieldNull}
              />
            </InspectorSection>
          )
          : (
            <InspectorSection
              defaultOpen
              icon={<FileJson size={14} aria-hidden='true' />}
              meta={resultView}
              open={sections?.jsonContext}
              title='JSON context'
              onOpenChange={(open) => onSectionOpenChange?.('jsonContext', open)}
            >
              <ResultViewFacts resultView={resultView} rows={rows} />
            </InspectorSection>
          )}
        <InspectorSection
          defaultOpen={false}
          icon={<Table2 size={14} aria-hidden='true' />}
          meta={`${fieldCatalog.length} fields`}
          open={sections?.fieldsInResults}
          title='Fields in results'
          onOpenChange={(open) => onSectionOpenChange?.('fieldsInResults', open)}
        >
          <FieldCatalogTable fields={fieldCatalog} rowCount={rows.length} />
        </InspectorSection>
      </PanelBody>
    </Panel>
  );
}

export function OverviewCollapseStrip({ onExpand }: { readonly onExpand: () => void; }) {
  return (
    <button
      className='grid h-full w-full place-items-center rounded-md border border-border-subtle bg-bg-panel text-text-muted hover:bg-action-ghost-hover hover:text-text-primary'
      type='button'
      onClick={onExpand}
    >
      <span className='flex items-center gap-2 [writing-mode:vertical-rl]'>
        <PanelRightOpen size={14} aria-hidden='true' />
        Result overview
      </span>
    </button>
  );
}

function FieldCatalogTable(
  { fields, rowCount }: {
    readonly fields: ReadonlyArray<FieldCatalogItem>;
    readonly rowCount: number;
  },
) {
  if (!fields.length) return <EmptyState title='No fields' />;
  return (
    <div className='select-text overflow-auto'>
      <table className='w-full min-w-[360px] border-collapse text-xs'>
        <thead>
          <tr className='border-b border-border-subtle bg-bg-subtle text-left text-text-muted'>
            <th className='h-8 px-3 font-semibold'>Field</th>
            <th className='h-8 px-3 font-semibold'>Types</th>
            <th className='h-8 px-3 font-semibold'>Docs</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.field} className='border-b border-border-subtle'>
              <td className='h-8 px-3'>
                <code>{field.field}</code>
              </td>
              <td className='h-8 max-w-40 truncate px-3 text-text-muted'>
                <code>{field.types.join(', ')}</code>
              </td>
              <td className='h-8 px-3 text-text-muted'>{field.count}/{rowCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SelectionPreviewProps {
  readonly document: FirestoreDocumentResult | null;
  readonly onDelete?: (() => void) | undefined;
  readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
  readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
  readonly onSetFieldValue?: ((target: FieldEditTarget, value: unknown) => void) | undefined;
  readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
  readonly expandedPaths?: ReadonlySet<string> | undefined;
  readonly onExpandedPathsChange?: ((expandedPaths: ReadonlySet<string>) => void) | undefined;
}

function SelectionPreview(
  {
    document,
    expandedPaths,
    onDelete,
    onDeleteField,
    onEdit,
    onEditField,
    onExpandedPathsChange,
    onOpenDocumentInNewTab,
    onSetFieldValue,
    onSetFieldNull,
  }: SelectionPreviewProps,
) {
  if (!document) {
    return (
      <EmptyState icon={<Braces size={20} aria-hidden='true' />} title='No document selected' />
    );
  }
  return (
    <div className='grid gap-2 p-3'>
      <div className='grid gap-2'>
        <div className='min-w-0 select-text font-mono text-xs text-text-secondary'>
          {document.path}
        </div>
        <div className='flex flex-wrap items-center gap-1'>
          <Badge>{Object.keys(document.data).length} fields</Badge>
          {document.hasSubcollections === true ? <Badge>subcollections</Badge> : null}
          {onEdit
            ? (
              <IconButton
                icon={<Edit3 size={14} aria-hidden='true' />}
                label='Edit document'
                size='xs'
                variant='ghost'
                onClick={onEdit}
              />
            )
            : null}
          {onDelete
            ? (
              <IconButton
                icon={<Trash2 size={14} aria-hidden='true' />}
                label='Delete document'
                size='xs'
                variant='ghost'
                onClick={onDelete}
              />
            )
            : null}
        </div>
      </div>
      <NestedValueTree
        document={document}
        expandedPaths={expandedPaths}
        value={document.data}
        onDeleteField={onDeleteField}
        onEditField={onEditField}
        onExpandedPathsChange={onExpandedPathsChange}
        onSetFieldValue={onSetFieldValue}
        onSetFieldNull={onSetFieldNull}
      />
      {document.subcollections?.length
        ? (
          <div className='grid gap-2 rounded-md border border-border-subtle p-2'>
            <div className='text-xs font-semibold text-text-secondary'>Subcollections</div>
            <SubcollectionChipList
              collections={document.subcollections}
              maxItems={MAX_SUBCOLLECTION_CHIPS}
              onOpenDocumentInNewTab={onOpenDocumentInNewTab}
            />
          </div>
        )
        : null}
    </div>
  );
}

function ResultViewFacts(
  { resultView, rows }: {
    readonly resultView: FirestoreResultView;
    readonly rows: ReadonlyArray<FirestoreDocumentResult>;
  },
) {
  return (
    <div className='grid gap-2 p-3 text-sm'>
      <DetailRow label='View' value={resultView} />
      <DetailRow label='Documents' value={String(rows.length)} />
      <DetailRow label='Fields' value={String(fieldCatalogForRows(rows).length)} />
    </div>
  );
}
