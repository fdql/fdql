import type { DensityName } from '@firebase-desk/design-tokens';
import { AccountTree, SidebarShell } from '@firebase-desk/product-ui';
import { IconButton } from '@firebase-desk/ui';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ComponentProps } from 'react';

type AccountTreeProps = ComponentProps<typeof AccountTree>;

interface AppSidebarProps {
  readonly collapsed: boolean;
  readonly density: DensityName;
  readonly filterValue: string;
  readonly items: AccountTreeProps['items'];
  readonly onAddProject?: AccountTreeProps['onAddProject'];
  readonly onCollapse: () => void;
  readonly onCreateCollection: AccountTreeProps['onCreateCollection'];
  readonly onCreateDocument: AccountTreeProps['onCreateDocument'];
  readonly onCollectionJob: AccountTreeProps['onCollectionJob'];
  readonly onEditItem?: AccountTreeProps['onEditItem'];
  readonly onExpand: () => void;
  readonly onFilterChange: AccountTreeProps['onFilterChange'];
  readonly onOpenItem: AccountTreeProps['onOpenItem'];
  readonly onRefreshItem: AccountTreeProps['onRefreshItem'];
  readonly onRemoveItem: AccountTreeProps['onRemoveItem'];
  readonly onSelectItem: AccountTreeProps['onSelectItem'];
  readonly onToggleItem: AccountTreeProps['onToggleItem'];
}

export function AppSidebar(
  {
    collapsed,
    density,
    filterValue,
    items,
    onAddProject,
    onCollapse,
    onCreateCollection,
    onCreateDocument,
    onCollectionJob,
    onEditItem,
    onExpand,
    onFilterChange,
    onOpenItem,
    onRefreshItem,
    onRemoveItem,
    onSelectItem,
    onToggleItem,
  }: AppSidebarProps,
) {
  if (collapsed) return <SidebarRail onExpand={onExpand} />;
  return (
    <SidebarShell
      title={
        <span className='flex min-w-0 flex-1 items-center justify-between gap-2'>
          <span className='truncate'>Workspace Tree</span>
          <IconButton
            icon={<PanelLeftClose size={14} aria-hidden='true' />}
            label='Collapse sidebar'
            size='xs'
            variant='ghost'
            onClick={onCollapse}
          />
        </span>
      }
    >
      <AccountTree
        density={density}
        filterValue={filterValue}
        items={items}
        onAddProject={onAddProject}
        onFilterChange={onFilterChange}
        onOpenItem={onOpenItem}
        onRefreshItem={onRefreshItem}
        onRemoveItem={onRemoveItem}
        onSelectItem={onSelectItem}
        onToggleItem={onToggleItem}
        {...(onCreateCollection ? { onCreateCollection } : {})}
        {...(onCreateDocument ? { onCreateDocument } : {})}
        {...(onCollectionJob ? { onCollectionJob } : {})}
        {...(onEditItem ? { onEditItem } : {})}
      />
    </SidebarShell>
  );
}

function SidebarRail({ onExpand }: { readonly onExpand: () => void; }) {
  return (
    <aside className='grid h-full grid-rows-[auto_minmax(0,1fr)] border-r border-border-subtle bg-bg-panel py-1'>
      <IconButton
        icon={<PanelLeftOpen size={14} aria-hidden='true' />}
        label='Expand sidebar'
        size='xs'
        variant='ghost'
        onClick={onExpand}
      />
      <div className='flex items-center justify-center [writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-normal text-text-muted'>
        Tree
      </div>
    </aside>
  );
}
