import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
} from '@firebase-desk/ui';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  Folder,
  ListTree,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

export type WorkspaceTabKind = 'firestore-query' | 'auth-users' | 'js-query' | 'firestore-sql';

export interface WorkspaceTabModel {
  readonly id: string;
  readonly kind: WorkspaceTabKind;
  readonly title: string;
  readonly connectionId: string;
  readonly canGoBack?: boolean;
  readonly canGoForward?: boolean;
}

export interface WorkspaceTabStripProps {
  readonly activeTabId: string;
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly tabs: ReadonlyArray<WorkspaceTabModel>;
  readonly onCloseAllTabs: () => void;
  readonly onCloseTab: (id: string) => void;
  readonly onCloseTabsToLeft: (id: string) => void;
  readonly onCloseTabsToRight: (id: string) => void;
  readonly onCloseOtherTabs: (id: string) => void;
  readonly onReorderTabs: (activeId: string, overId: string) => void;
  readonly onSelectTab: (id: string) => void;
  readonly onSortByProject: () => void;
}

export function WorkspaceTabStrip(
  {
    activeTabId,
    projects,
    tabs,
    onCloseAllTabs,
    onCloseTab,
    onCloseOtherTabs,
    onCloseTabsToLeft,
    onCloseTabsToRight,
    onReorderTabs,
    onSelectTab,
    onSortByProject,
  }: WorkspaceTabStripProps,
) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
    hasOverflow: false,
  });

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setScrollState({
      canScrollLeft: element.scrollLeft > 1,
      canScrollRight: element.scrollLeft < maxScrollLeft - 1,
      hasOverflow: maxScrollLeft > 1,
    });
  }, []);

  useEffect(() => {
    updateScrollState();
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener('scroll', updateScrollState, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollState);
    resizeObserver?.observe(element);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(updateScrollState);
    return () => {
      element.removeEventListener('scroll', updateScrollState);
      resizeObserver?.disconnect();
    };
  }, [tabs.length, updateScrollState]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) {
      onReorderTabs(String(event.active.id), String(event.over.id));
    }
  };

  const scrollTabs = (direction: -1 | 1) => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = Math.max(180, Math.floor(element.clientWidth * 0.7));
    if (typeof element.scrollBy === 'function') {
      element.scrollBy({ left: direction * distance, behavior: 'smooth' });
    } else {
      element.scrollLeft += direction * distance;
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(updateScrollState);
    else updateScrollState();
  };

  return (
    <div className='flex h-[var(--density-tab-height)] min-w-0 items-stretch border-b border-border-subtle bg-gradient-to-b from-bg-subtle to-bg-panel'>
      {scrollState.hasOverflow
        ? (
          <IconButton
            disabled={!scrollState.canScrollLeft}
            icon={<ChevronLeft size={14} aria-hidden='true' />}
            label='Scroll tabs left'
            size='xs'
            variant='ghost'
            className='h-full rounded-none border-r border-border-subtle'
            onClick={() => scrollTabs(-1)}
          />
        )
        : null}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollRef}
            className='flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            role='tablist'
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                active={tab.id === activeTabId}
                projects={projects}
                tab={tab}
                onCloseAllTabs={onCloseAllTabs}
                onCloseTab={onCloseTab}
                onCloseOtherTabs={onCloseOtherTabs}
                onCloseTabsToLeft={onCloseTabsToLeft}
                onCloseTabsToRight={onCloseTabsToRight}
                onSelectTab={onSelectTab}
                onSortByProject={onSortByProject}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {scrollState.hasOverflow
        ? (
          <IconButton
            disabled={!scrollState.canScrollRight}
            icon={<ChevronRight size={14} aria-hidden='true' />}
            label='Scroll tabs right'
            size='xs'
            variant='ghost'
            className='h-full rounded-none border-l border-border-subtle'
            onClick={() => scrollTabs(1)}
          />
        )
        : null}
    </div>
  );
}

interface SortableTabProps {
  readonly active: boolean;
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly tab: WorkspaceTabModel;
  readonly onCloseAllTabs: () => void;
  readonly onCloseTab: (id: string) => void;
  readonly onCloseTabsToLeft: (id: string) => void;
  readonly onCloseTabsToRight: (id: string) => void;
  readonly onCloseOtherTabs: (id: string) => void;
  readonly onSelectTab: (id: string) => void;
  readonly onSortByProject: () => void;
}

function SortableTab(
  {
    active,
    projects,
    tab,
    onCloseAllTabs,
    onCloseOtherTabs,
    onCloseTab,
    onCloseTabsToLeft,
    onCloseTabsToRight,
    onSelectTab,
    onSortByProject,
  }: SortableTabProps,
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  const project = projects.find((item) => item.id === tab.connectionId);
  const style = { transform: CSS.Transform.toString(transform), transition };
  const icon = iconForTabKind(tab.kind);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={cn(
            'relative grid h-full min-w-[clamp(150px,18vw,190px)] max-w-[260px] shrink-0 grid-cols-[minmax(0,1fr)_22px] items-center gap-2 border-r border-border-subtle px-2 text-left text-sm text-text-secondary transition-colors hover:bg-action-ghost-hover',
            'cursor-grab active:cursor-grabbing',
            active
              && 'bg-bg-panel text-text-primary after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-action-primary',
            isDragging && 'z-10 border-l border-action-primary bg-bg-panel opacity-80 shadow-lg',
          )}
          role='tab'
          style={style}
          tabIndex={active ? 0 : -1}
          aria-selected={active}
          onClick={() => onSelectTab(tab.id)}
        >
          <span className='flex min-w-0 items-center gap-2'>
            <span className='grid size-4 shrink-0 place-items-center text-text-muted'>{icon}</span>
            <span className='min-w-0 truncate font-semibold'>{tab.title}</span>
            <span className='truncate text-xs text-text-muted'>
              {project?.name ?? 'No project'}
            </span>
          </span>
          <IconButton
            icon={<X size={13} aria-hidden='true' />}
            label={`Close ${tab.title}`}
            size='xs'
            variant='ghost'
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onCloseTab(tab.id);
            }}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className='min-w-52 p-1.5'>
        <TabContextMenuItem
          icon={<X size={13} aria-hidden='true' />}
          onSelect={() => onCloseTab(tab.id)}
        >
          Close tab
        </TabContextMenuItem>
        <TabContextMenuItem
          icon={<X size={13} aria-hidden='true' />}
          onSelect={() => onCloseOtherTabs(tab.id)}
        >
          Close others
        </TabContextMenuItem>
        <TabContextMenuItem
          icon={<ArrowLeft size={13} aria-hidden='true' />}
          onSelect={() => onCloseTabsToLeft(tab.id)}
        >
          Close tabs to left
        </TabContextMenuItem>
        <TabContextMenuItem
          icon={<ArrowRight size={13} aria-hidden='true' />}
          onSelect={() => onCloseTabsToRight(tab.id)}
        >
          Close tabs to right
        </TabContextMenuItem>
        <ContextMenuSeparator />
        <TabContextMenuItem
          icon={<Database size={13} aria-hidden='true' />}
          onSelect={onSortByProject}
        >
          Sort by connection
        </TabContextMenuItem>
        <TabContextMenuItem
          icon={<Trash2 size={13} aria-hidden='true' />}
          onSelect={onCloseAllTabs}
        >
          Close all
        </TabContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface TabContextMenuItemProps {
  readonly children: ReactNode;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

function TabContextMenuItem({ children, icon, onSelect }: TabContextMenuItemProps) {
  return (
    <ContextMenuItem className='gap-2 px-2.5' onSelect={onSelect}>
      <span className='grid size-4 shrink-0 place-items-center text-text-muted'>{icon}</span>
      <span className='min-w-0 flex-1 truncate'>{children}</span>
    </ContextMenuItem>
  );
}

function iconForTabKind(kind: WorkspaceTabKind): ReactNode {
  if (kind === 'firestore-query') return <Database size={14} aria-hidden='true' />;
  if (kind === 'auth-users') return <Users size={14} aria-hidden='true' />;
  if (kind === 'js-query') return <Code2 size={14} aria-hidden='true' />;
  if (kind === 'firestore-sql') return <ListTree size={14} aria-hidden='true' />;
  return <Folder size={14} aria-hidden='true' />;
}

export type WorkspaceTabStripNode = ReactNode;
