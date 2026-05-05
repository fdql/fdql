import type { DensityName } from '@firebase-desk/design-tokens';
import type { ProjectTarget } from '@firebase-desk/repo-contracts';
import {
  Badge,
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  IconButton,
  Input,
  VirtualTree,
  type VirtualTreeNode,
} from '@firebase-desk/ui';
import {
  AlertCircle,
  ChevronRight,
  Code2,
  Database,
  Folder,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { type ReactNode } from 'react';

export type AccountTreeItemKind =
  | 'auth'
  | 'collection'
  | 'firestore'
  | 'project'
  | 'script'
  | 'sql'
  | 'status';
export type AccountTreeItemStatus = 'idle' | 'loading' | 'error';

export interface AccountTreeItem extends VirtualTreeNode {
  readonly kind: AccountTreeItemKind;
  readonly projectTarget?: ProjectTarget;
  readonly secondary?: string;
  readonly selected?: boolean;
  readonly status?: AccountTreeItemStatus;
  readonly canCreateCollection?: boolean;
  readonly canRefresh?: boolean;
  readonly canRemove?: boolean;
}

export interface AccountTreeProps {
  readonly density?: DensityName | undefined;
  readonly filterValue: string;
  readonly items: ReadonlyArray<AccountTreeItem>;
  readonly onAddProject?: (() => void) | undefined;
  readonly onCreateCollection?: (id: string) => void;
  readonly onCreateDocument?: (id: string) => void;
  readonly onCollectionJob?: (
    id: string,
    kind: 'copy' | 'delete' | 'duplicate' | 'export' | 'import',
  ) => void;
  readonly onFilterChange: (value: string) => void;
  readonly onEditItem?: (id: string) => void;
  readonly onOpenItem: (id: string) => void;
  readonly onRefreshItem: (id: string) => void;
  readonly onRemoveItem: (id: string) => void;
  readonly onSelectItem: (id: string) => void;
  readonly onToggleItem: (id: string) => void;
}

export function AccountTree(
  {
    density,
    filterValue,
    items,
    onAddProject,
    onCreateCollection,
    onCreateDocument,
    onCollectionJob,
    onEditItem,
    onFilterChange,
    onOpenItem,
    onRefreshItem,
    onRemoveItem,
    onSelectItem,
    onToggleItem,
  }: AccountTreeProps,
) {
  return (
    <div className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2'>
      <div className='grid gap-2'>
        <div className='flex items-center gap-1'>
          <Input
            aria-label='Filter account tree'
            placeholder='Filter tree'
            value={filterValue}
            onChange={(event) => onFilterChange(event.currentTarget.value)}
          />
          {onAddProject
            ? (
              <IconButton
                icon={<Plus size={15} aria-hidden='true' />}
                label='Add project'
                variant='primary'
                onClick={onAddProject}
              />
            )
            : null}
        </div>
      </div>
      <div className='min-h-0'>
        <VirtualTree
          ariaLabel='Account tree'
          density={density}
          flattenedNodes={items}
          renderNode={(node) => (
            <AccountTreeRow
              item={node as AccountTreeItem}
              {...(onCreateCollection ? { onCreateCollection } : {})}
              {...(onCreateDocument ? { onCreateDocument } : {})}
              {...(onCollectionJob ? { onCollectionJob } : {})}
              {...(onEditItem ? { onEditItem } : {})}
              onRefreshItem={onRefreshItem}
              onRemoveItem={onRemoveItem}
            />
          )}
          onOpen={onOpenItem}
          onSelect={onSelectItem}
          onToggle={onToggleItem}
        />
      </div>
    </div>
  );
}

interface AccountTreeRowProps {
  readonly item: AccountTreeItem;
  readonly onCreateCollection?: (id: string) => void;
  readonly onCreateDocument?: (id: string) => void;
  readonly onCollectionJob?: (
    id: string,
    kind: 'copy' | 'delete' | 'duplicate' | 'export' | 'import',
  ) => void;
  readonly onEditItem?: (id: string) => void;
  readonly onRefreshItem: (id: string) => void;
  readonly onRemoveItem: (id: string) => void;
}

function AccountTreeRow(
  {
    item,
    onCreateCollection,
    onCreateDocument,
    onCollectionJob,
    onEditItem,
    onRefreshItem,
    onRemoveItem,
  }: AccountTreeRowProps,
) {
  const icon = iconForKind(item.kind);
  const row = (
    <div
      className={cn(
        'group/tree-row relative flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-text-primary transition-colors hover:bg-action-ghost-hover',
        item.selected
          && 'bg-action-selected text-action-primary shadow-[inset_0_0_0_1px_var(--color-action-primary)]',
        item.status && 'text-text-muted',
      )}
      title={item.secondary ? `${item.label}: ${item.secondary}` : item.label}
    >
      <span className='grid size-4 shrink-0 place-items-center text-text-muted'>
        {item.hasChildren
          ? (
            <ChevronRight
              className={cn('transition-transform', item.expanded && 'rotate-90')}
              size={14}
              aria-hidden='true'
            />
          )
          : null}
      </span>
      <span className='grid size-4 shrink-0 place-items-center text-action-primary'>{icon}</span>
      <span className='min-w-0 flex-1 truncate'>{item.label}</span>
      {item.status === 'loading' ? <span className='text-xs text-text-muted'>Loading</span> : null}
      {item.status === 'error'
        ? <AlertCircle className='text-status-danger-text' size={14} aria-label='Load failed' />
        : null}
      {item.secondary && item.kind !== 'collection'
        ? (
          <span className='max-w-24 truncate rounded-full bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted'>
            {item.secondary}
          </span>
        )
        : null}
      {item.projectTarget === 'emulator'
        ? <Badge variant={item.projectTarget}>{item.projectTarget}</Badge>
        : null}
      {item.kind === 'firestore' && item.canCreateCollection && onCreateCollection
        ? (
          <IconButton
            icon={<Plus size={13} aria-hidden='true' />}
            label={`New collection in ${item.label}`}
            size='xs'
            variant='ghost'
            onClick={(event) => {
              event.stopPropagation();
              onCreateCollection(item.id);
            }}
          />
        )
        : null}
      {item.canRefresh
        ? (
          <IconButton
            icon={<RefreshCw size={13} aria-hidden='true' />}
            label={`Refresh ${item.label}`}
            size='xs'
            variant='ghost'
            className='opacity-0 transition-opacity group-hover/tree-row:opacity-100'
            onClick={(event) => {
              event.stopPropagation();
              onRefreshItem(item.id);
            }}
          />
        )
        : null}
      {item.kind === 'project' && onEditItem
        ? (
          <IconButton
            icon={<Pencil size={13} aria-hidden='true' />}
            label={`Edit ${item.label}`}
            size='xs'
            variant='ghost'
            className='opacity-0 transition-opacity group-hover/tree-row:opacity-100'
            onClick={(event) => {
              event.stopPropagation();
              onEditItem(item.id);
            }}
          />
        )
        : null}
      {item.canRemove
        ? (
          <IconButton
            icon={<Trash2 size={13} aria-hidden='true' />}
            label={`Remove ${item.label}`}
            size='xs'
            variant='ghost'
            className='opacity-0 transition-opacity group-hover/tree-row:opacity-100'
            onClick={(event) => {
              event.stopPropagation();
              onRemoveItem(item.id);
            }}
          />
        )
        : null}
    </div>
  );

  const hasProjectMenu = item.kind === 'project' && onEditItem;
  const hasFirestoreMenu = item.kind === 'firestore' && item.canCreateCollection
    && onCreateCollection;
  const hasCollectionMenu = item.kind === 'collection' && (onCreateDocument || onCollectionJob);

  if (!hasProjectMenu && !hasFirestoreMenu && !hasCollectionMenu) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        {hasProjectMenu
          ? <ContextMenuItem onSelect={() => onEditItem(item.id)}>Edit account</ContextMenuItem>
          : null}
        {hasFirestoreMenu
          ? (
            <ContextMenuItem onSelect={() => onCreateCollection(item.id)}>
              New collection
            </ContextMenuItem>
          )
          : null}
        {hasCollectionMenu
          ? (
            <>
              {onCreateDocument
                ? (
                  <ContextMenuItem onSelect={() => onCreateDocument(item.id)}>
                    New document
                  </ContextMenuItem>
                )
                : null}
              {onCollectionJob
                ? (
                  <>
                    <ContextMenuItem onSelect={() => onCollectionJob(item.id, 'copy')}>
                      Copy collection
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onCollectionJob(item.id, 'duplicate')}>
                      Duplicate collection
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onCollectionJob(item.id, 'export')}>
                      Export collection
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onCollectionJob(item.id, 'import')}>
                      Import collection
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onCollectionJob(item.id, 'delete')}>
                      Delete collection
                    </ContextMenuItem>
                  </>
                )
                : null}
            </>
          )
          : null}
        {item.canRefresh
          ? <ContextMenuItem onSelect={() => onRefreshItem(item.id)}>Refresh</ContextMenuItem>
          : null}
        {item.canRemove
          ? <ContextMenuItem onSelect={() => onRemoveItem(item.id)}>Remove</ContextMenuItem>
          : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function iconForKind(kind: AccountTreeItemKind): ReactNode {
  if (kind === 'project') return <Database size={15} aria-hidden='true' />;
  if (kind === 'firestore') return <Folder size={15} aria-hidden='true' />;
  if (kind === 'auth') return <Users size={15} aria-hidden='true' />;
  if (kind === 'script') return <Code2 size={15} aria-hidden='true' />;
  if (kind === 'sql') return <ListTree size={15} aria-hidden='true' />;
  if (kind === 'collection') return <Folder size={15} aria-hidden='true' />;
  return <AlertCircle size={15} aria-hidden='true' />;
}
