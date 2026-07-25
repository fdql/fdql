import type {
  FirestoreFieldCatalogEntry,
  FirestoreFilterOp,
  FirestoreQueryDraft,
  FirestoreQueryDraftEdit,
  FirestoreQueryFilterDraft,
} from '@firebase-desk/repo-contracts';
import { Badge, Button, IconButton, Input, Panel, PanelBody, PanelHeader } from '@firebase-desk/ui';
import { Folder, Loader2, Play, Plus, RotateCcw, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { FieldAutocompleteInput } from './FieldAutocompleteInput.tsx';

interface QueryBuilderProps {
  readonly draft: FirestoreQueryDraft;
  readonly fieldSuggestions?: ReadonlyArray<FirestoreFieldCatalogEntry>;
  readonly isLoading: boolean;
  readonly onDraftEdit: (edit: FirestoreQueryDraftEdit) => void;
  readonly onRun: () => void;
}

interface ConfirmationRequest {
  readonly confirmLabel: string;
  readonly description: ReactNode;
  readonly onConfirm: () => void;
  readonly title: string;
}

const filterOps: ReadonlyArray<FirestoreFilterOp> = [
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'array-contains',
  'array-contains-any',
  'in',
  'not-in',
];

const selectClassName =
  'h-[var(--density-control-height)] rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-60';

export function QueryBuilder(
  {
    draft,
    fieldSuggestions = [],
    isLoading,
    onDraftEdit,
    onRun,
  }: QueryBuilderProps,
) {
  const supportsCollectionControls = isCollectionPath(draft.path);
  const filters = filtersForDraft(draft);
  const sortableFieldSuggestions = useMemo(
    () =>
      fieldSuggestions.filter((suggestion) =>
        suggestion.types.every((type) => !type.startsWith('array<'))
      ),
    [fieldSuggestions],
  );
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);

  function updateFilter(
    filterId: string,
    patch: Extract<FirestoreQueryDraftEdit, { readonly type: 'filter-patch'; }>['patch'],
  ) {
    onDraftEdit({ type: 'filter-patch', filterId, patch });
  }

  function addFilter() {
    onDraftEdit({ type: 'filter-add', filter: createEmptyFilter(nextFilterId(filters)) });
  }

  function removeFilter(filterId: string) {
    onDraftEdit({ type: 'filter-remove', filterId });
  }

  function confirmRemoveFilter(filter: FirestoreQueryFilterDraft, index: number) {
    setConfirmation({
      confirmLabel: 'Remove',
      description: filter.field
        ? `Remove filter on ${filter.field}?`
        : `Remove filter ${index + 1}?`,
      onConfirm: () => removeFilter(filter.id),
      title: 'Remove filter',
    });
  }

  function confirmReset() {
    setConfirmation({
      confirmLabel: 'Reset',
      description: 'Reset filters, sort, and limit for this tab?',
      onConfirm: () => onDraftEdit({ type: 'reset' }),
      title: 'Reset query',
    });
  }

  return (
    <>
      <Panel className='overflow-visible'>
        <PanelHeader actions={<Badge>{supportsCollectionControls ? 'collection' : 'path'}</Badge>}>
          <span className='flex min-w-0 items-center gap-2'>
            <Folder size={15} aria-hidden='true' />
            <span className='truncate'>Query target</span>
          </span>
        </PanelHeader>
        <PanelBody className='grid gap-2 overflow-visible'>
          <div
            className={supportsCollectionControls
              ? 'grid grid-cols-[minmax(180px,1fr)_96px_auto] items-center gap-2'
              : 'grid grid-cols-[minmax(180px,1fr)_auto] items-center gap-2'}
          >
            <Input
              aria-label='Query path'
              className='font-mono'
              disabled={isLoading}
              placeholder='orders or orders/ord_1024'
              value={draft.path}
              onChange={(event) =>
                onDraftEdit({ type: 'path-set', path: event.currentTarget.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRun();
              }}
            />
            {supportsCollectionControls
              ? (
                <Input
                  aria-label='Result limit'
                  className='font-mono'
                  disabled={isLoading}
                  min={1}
                  max={100}
                  type='number'
                  value={draft.limit}
                  onChange={(event) =>
                    onDraftEdit({
                      type: 'limit-set',
                      limit: Number(event.currentTarget.value) || 1,
                    })}
                />
              )
              : null}
            <Button disabled={isLoading} variant='primary' onClick={onRun}>
              {isLoading
                ? <Loader2 className='animate-spin' size={14} aria-hidden='true' />
                : <Play size={14} aria-hidden='true' />}
              Run
            </Button>
          </div>
          {supportsCollectionControls
            ? (
              <>
                <div className='grid gap-2'>
                  {filters.map((filter, index) => (
                    <div
                      key={filter.id}
                      className='grid grid-cols-[minmax(140px,1fr)_130px_minmax(140px,1fr)_auto_auto] items-center gap-2'
                    >
                      <FieldAutocompleteInput
                        ariaLabel={`Filter ${index + 1} field`}
                        className='font-mono'
                        disabled={isLoading}
                        placeholder='field name'
                        suggestions={fieldSuggestions}
                        value={filter.field}
                        onCommit={(field) => updateFilter(filter.id, { field })}
                      />
                      <select
                        aria-label={`Filter ${index + 1} operator`}
                        className={selectClassName}
                        disabled={isLoading}
                        value={filter.op}
                        onChange={(event) =>
                          updateFilter(filter.id, {
                            op: event.currentTarget.value as FirestoreFilterOp,
                          })}
                      >
                        {filterOps.map((op) => <option key={op} value={op}>{op}</option>)}
                      </select>
                      <Input
                        aria-label={`Filter ${index + 1} value`}
                        className='font-mono'
                        disabled={isLoading}
                        placeholder='value, JSON, or null'
                        value={filter.value}
                        onChange={(event) =>
                          updateFilter(filter.id, { value: event.currentTarget.value })}
                      />
                      <Button
                        disabled={isLoading}
                        size='xs'
                        title='Set filter value to JSON null'
                        variant={filter.value.trim() === 'null' ? 'primary' : 'secondary'}
                        onClick={() => updateFilter(filter.id, { value: 'null' })}
                      >
                        Null
                      </Button>
                      <IconButton
                        disabled={isLoading}
                        icon={<X size={14} aria-hidden='true' />}
                        label={`Remove filter ${index + 1}`}
                        size='xs'
                        variant='ghost'
                        onClick={() => confirmRemoveFilter(filter, index)}
                      />
                    </div>
                  ))}
                  <div className='flex items-center justify-between gap-2'>
                    <Button disabled={isLoading} size='xs' variant='secondary' onClick={addFilter}>
                      <Plus size={14} aria-hidden='true' /> Filter
                    </Button>
                    <Button disabled={isLoading} size='xs' variant='ghost' onClick={confirmReset}>
                      <RotateCcw size={14} aria-hidden='true' /> Reset
                    </Button>
                  </div>
                </div>
                <div className='grid grid-cols-[minmax(140px,1fr)_130px] items-center gap-2'>
                  <FieldAutocompleteInput
                    ariaLabel='Sort field'
                    className='font-mono'
                    disabled={isLoading}
                    placeholder='field name'
                    suggestions={sortableFieldSuggestions}
                    value={draft.sortField}
                    onCommit={(sortField) => onDraftEdit({ type: 'sort-field-set', sortField })}
                  />
                  <select
                    aria-label='Sort direction'
                    className={selectClassName}
                    disabled={isLoading}
                    value={draft.sortDirection}
                    onChange={(event) =>
                      onDraftEdit({
                        type: 'sort-direction-set',
                        sortDirection: event.currentTarget.value as 'asc' | 'desc',
                      })}
                  >
                    <option value='asc'>asc</option>
                    <option value='desc'>desc</option>
                  </select>
                </div>
              </>
            )
            : (
              <div className='rounded-md border border-border-subtle bg-bg-subtle px-2 py-1 text-xs text-text-secondary'>
                Filters, sorting, limits, and pagination are hidden for document and nested paths.
              </div>
            )}
        </PanelBody>
      </Panel>
      <ConfirmDialog
        confirmLabel={confirmation?.confirmLabel ?? 'Confirm'}
        description={confirmation?.description ?? null}
        open={Boolean(confirmation)}
        title={confirmation?.title ?? 'Confirm operation'}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        {...(confirmation?.onConfirm ? { onConfirm: confirmation.onConfirm } : {})}
      />
    </>
  );
}

function createEmptyFilter(id = 'filter-1'): FirestoreQueryFilterDraft {
  return { id, field: '', op: '==', value: '' };
}

function filtersForDraft(draft: FirestoreQueryDraft): ReadonlyArray<FirestoreQueryFilterDraft> {
  return (draft.filters ?? []).map((filter, index) => ({
    id: filter.id || `filter-${index + 1}`,
    field: filter.field,
    op: filter.op,
    value: filter.value,
  }));
}

function nextFilterId(filters: ReadonlyArray<FirestoreQueryFilterDraft>): string {
  let index = filters.length + 1;
  while (filters.some((filter) => filter.id === `filter-${index}`)) index += 1;
  return `filter-${index}`;
}

function isCollectionPath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return parts.length % 2 === 1;
}
