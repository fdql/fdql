import {
  FirestoreGeoPoint,
  FirestoreReference,
  FirestoreTimestamp,
} from '@firebase-desk/data-format';
import type {
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  FirestoreQueryDraft,
  ProjectSummary,
  ScriptRunResult,
} from '@firebase-desk/repo-contracts';
import { MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Key, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../appearance/AppearanceProvider.tsx';
import { FirestoreDocumentBrowser } from './firestore/FirestoreDocumentBrowser.tsx';
import { FirestoreQuerySurface } from './firestore/FirestoreQuerySurface.tsx';
import { JS_QUERY_SAMPLE_SOURCE, JsQuerySurface } from './js-query/JsQuerySurface.tsx';
import { AccountTree } from './projects/AccountTree.tsx';
import { WorkspaceTabStrip } from './tabs/WorkspaceTabStrip.tsx';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (
    { count, estimateSize }: {
      readonly count: number;
      readonly estimateSize: (i: number) => number;
    },
  ) => {
    const size = count > 0 ? estimateSize(0) : 0;
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, i) => ({ index: i, key: i, start: i * size, size })),
    };
  },
}));

vi.mock('@monaco-editor/react', () => ({
  default: (
    {
      onChange,
      options,
      value,
    }: {
      readonly onChange?: (value: string) => void;
      readonly options?: { readonly readOnly?: boolean; };
      readonly value: string;
    },
  ) => (
    <textarea
      data-testid='monaco'
      readOnly={options?.readOnly ?? false}
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
  loader: { config: vi.fn() },
}));

vi.mock('@firebase-desk/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@firebase-desk/ui')>();
  type DataTableColumnMock = {
    readonly id: string;
    readonly header?: unknown;
    readonly cell?: (context: { readonly row: { readonly original: unknown; }; }) => ReactNode;
  };
  return {
    ...actual,
    DataTable: (
      {
        columns,
        data,
        emptyState,
        getRowId,
        onRowClick,
        onRowDoubleClick,
      }: {
        readonly columns: ReadonlyArray<DataTableColumnMock>;
        readonly data: ReadonlyArray<unknown>;
        readonly emptyState?: ReactNode;
        readonly getRowId?: (row: unknown, index: number) => string;
        readonly onRowClick?: (row: unknown) => void;
        readonly onRowDoubleClick?: (row: unknown) => void;
      },
    ) =>
      data.length
        ? (
          <div>
            {data.map((row, index) => (
              <div
                key={getRowId?.(row, index) ?? index}
                onClick={() => onRowClick?.(row)}
                onDoubleClick={() => onRowDoubleClick?.(row)}
              >
                {columns.map((column) => (
                  <span key={column.id}>
                    {column.cell?.({ row: { original: row } })}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )
        : <>{emptyState ?? null}</>,
    ExplorerTree: (
      {
        onToggle,
        renderAction,
        rows,
      }: {
        readonly onToggle: (id: string) => void;
        readonly renderAction?: (node: {
          readonly id: string;
          readonly label: ReactNode;
        }) => ReactNode;
        readonly rows: ReadonlyArray<{
          readonly expanded?: boolean;
          readonly hasChildren?: boolean;
          readonly id: string;
          readonly label: ReactNode;
          readonly meta?: ReactNode;
          readonly value?: ReactNode;
        }>;
      },
    ) => (
      <div role='tree'>
        {rows.map((node) => (
          <div
            key={node.id}
            aria-expanded={node.hasChildren ? Boolean(node.expanded) : undefined}
            role='treeitem'
            onClick={() => {
              if (node.hasChildren) onToggle(node.id);
            }}
          >
            <span>{node.label}</span>
            <span>{node.value}</span>
            <span>{node.meta}</span>
            {renderAction?.(node)}
          </div>
        ))}
      </div>
    ),
    VirtualList: (
      {
        getItemKey,
        items,
        renderItem,
      }: {
        readonly getItemKey?: (item: unknown, index: number) => Key;
        readonly items: ReadonlyArray<unknown>;
        readonly renderItem: (item: unknown, index: number) => ReactNode;
      },
    ) => (
      <div>
        {items.map((item, index) => (
          <div key={getItemKey?.(item, index) ?? index}>{renderItem(item, index)}</div>
        ))}
      </div>
    ),
    VirtualTree: (
      {
        ariaLabel,
        flattenedNodes,
        onOpen,
        onSelect,
        onToggle,
        renderNode,
      }: {
        readonly ariaLabel?: string;
        readonly flattenedNodes: ReadonlyArray<{
          readonly id: string;
          readonly hasChildren: boolean;
          readonly label: string;
        }>;
        readonly onOpen?: (id: string) => void;
        readonly onSelect?: (id: string) => void;
        readonly onToggle: (id: string) => void;
        readonly renderNode?: (node: unknown) => ReactNode;
      },
    ) => (
      <div aria-label={ariaLabel} role='tree'>
        {flattenedNodes.map((node) => (
          <div
            key={node.id}
            role='treeitem'
            onClick={() => {
              onSelect?.(node.id);
              if (node.hasChildren) onToggle(node.id);
            }}
            onDoubleClick={() => onOpen?.(node.id)}
          >
            {renderNode ? renderNode(node) : node.label}
          </div>
        ))}
      </div>
    ),
  };
});

const projects: ReadonlyArray<ProjectSummary> = [
  {
    id: 'emu',
    name: 'Local Emulator',
    projectId: 'demo-local',
    target: 'emulator',
    emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
    hasCredential: false,
    credentialEncrypted: null,
    createdAt: '2026-04-27T00:00:00.000Z',
  },
  {
    id: 'prod',
    name: 'Acme Prod',
    projectId: 'acme-prod',
    target: 'production',
    hasCredential: true,
    credentialEncrypted: true,
    createdAt: '2026-04-27T00:00:00.000Z',
  },
];

const nestedEvent: FirestoreDocumentResult = {
  id: 'evt_created',
  path: 'orders/ord_1024/events/evt_created',
  data: { type: 'created' },
  hasSubcollections: false,
};

const encodedUpdatedAt = {
  __type__: 'timestamp',
  value: '2026-04-24T09:30:12.058Z',
};

const documents: ReadonlyArray<FirestoreDocumentResult> = [
  {
    id: 'ord_1024',
    path: 'orders/ord_1024',
    data: {
      status: 'paid',
      total: 129.4,
      updatedAt: encodedUpdatedAt,
      deliveryLocation: { __type__: 'geoPoint', latitude: -36.8485, longitude: 174.7633 },
      customerRef: { __type__: 'reference', path: 'customers/cus_ada' },
      meta: { channel: 'web' },
      tags: ['priority'],
    },
    hasSubcollections: true,
    subcollections: [
      {
        id: 'events',
        path: 'orders/ord_1024/events',
        documentCount: 1,
        documents: [nestedEvent],
      } as FirestoreCollectionNode & {
        readonly documents: ReadonlyArray<FirestoreDocumentResult>;
      },
    ],
  },
  {
    id: 'ord_1025',
    path: 'orders/ord_1025',
    data: { status: 'pending', total: 42 },
    hasSubcollections: false,
  },
];

const draft: FirestoreQueryDraft = {
  path: 'orders',
  filters: [{ id: 'filter-1', field: 'status', op: '==', value: 'paid' }],
  filterField: 'status',
  filterOp: '==',
  filterValue: 'paid',
  limit: 25,
  sortDirection: 'desc',
  sortField: 'updatedAt',
};

const scriptResult: ScriptRunResult = {
  returnValue: documents,
  stream: [
    {
      id: 'yield-document-snapshot',
      label: 'yield DocumentSnapshot',
      badge: 'orders/ord_1024',
      view: 'json',
      value: documents[0],
    },
    {
      id: 'yield-query-snapshot',
      label: 'yield QuerySnapshot',
      badge: 'orders where status == paid',
      view: 'table',
      value: documents,
    },
  ],
  logs: [{ level: 'info', message: 'Fetched 2 orders', timestamp: '2026-04-27T10:41:03.000Z' }],
  errors: [],
  durationMs: 4,
};

function expectedUserTimestamp(iso: string): string {
  const date = new Date(iso);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `${sign}${pad2(Math.floor(absoluteMinutes / 60))}:${pad2(absoluteMinutes % 60)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function renderWithAppearance(ui: ReactNode) {
  render(
    <AppearanceProvider settings={new MockSettingsRepository()}>
      {ui}
    </AppearanceProvider>,
  );
}

describe('feature surfaces', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  it('AccountTree forwards selection, toggle, and add actions', () => {
    const onAddProject = vi.fn();
    const onSelectItem = vi.fn();
    const onToggleItem = vi.fn();
    render(
      <AccountTree
        filterValue=''
        items={[
          {
            id: 'project:emu',
            kind: 'project',
            label: 'Local Emulator',
            depth: 0,
            hasChildren: true,
            expanded: true,
            projectTarget: 'emulator',
          },
          {
            id: 'project:prod',
            kind: 'project',
            label: 'Acme Prod',
            depth: 0,
            hasChildren: false,
            expanded: false,
            projectTarget: 'production',
          },
          {
            id: 'firestore:emu',
            kind: 'firestore',
            label: 'Firestore',
            depth: 1,
            hasChildren: true,
            expanded: false,
          },
          {
            id: 'collection:emu:orders',
            kind: 'collection',
            label: 'orders',
            depth: 2,
            hasChildren: false,
            expanded: false,
            secondary: '99',
          },
        ]}
        onAddProject={onAddProject}
        onFilterChange={() => {}}
        onOpenItem={() => {}}
        onRefreshItem={() => {}}
        onRemoveItem={() => {}}
        onSelectItem={onSelectItem}
        onToggleItem={onToggleItem}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    fireEvent.click(screen.getByText('Firestore'));

    expect(screen.getByText('emulator')).toBeTruthy();
    expect(screen.queryByText('production')).toBeNull();
    expect(screen.queryByText('99')).toBeNull();
    expect(onAddProject).toHaveBeenCalledTimes(1);
    expect(onSelectItem).toHaveBeenCalledWith('firestore:emu');
    expect(onToggleItem).toHaveBeenCalledWith('firestore:emu');
  });

  it('AccountTree exposes new document action on collection context menu', async () => {
    const onCreateDocument = vi.fn();
    render(
      <AccountTree
        filterValue=''
        items={[{
          id: 'collection:emu:orders',
          kind: 'collection',
          label: 'orders',
          depth: 0,
          hasChildren: false,
          expanded: false,
        }]}
        onAddProject={() => {}}
        onCreateDocument={onCreateDocument}
        onFilterChange={() => {}}
        onOpenItem={() => {}}
        onRefreshItem={() => {}}
        onRemoveItem={() => {}}
        onSelectItem={() => {}}
        onToggleItem={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByText('orders'));
    fireEvent.click(await screen.findByText('New document'));

    expect(onCreateDocument).toHaveBeenCalledWith('collection:emu:orders');
  });

  it('AccountTree exposes collection job actions on collection context menu', async () => {
    const onCollectionJob = vi.fn();
    render(
      <AccountTree
        filterValue=''
        items={[{
          id: 'collection:emu:orders',
          kind: 'collection',
          label: 'orders',
          depth: 0,
          hasChildren: false,
          expanded: false,
        }]}
        onAddProject={() => {}}
        onCollectionJob={onCollectionJob}
        onFilterChange={() => {}}
        onOpenItem={() => {}}
        onRefreshItem={() => {}}
        onRemoveItem={() => {}}
        onSelectItem={() => {}}
        onToggleItem={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByText('orders'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete collection' }));

    expect(onCollectionJob).toHaveBeenCalledWith('collection:emu:orders', 'delete');
  });

  it('AccountTree exposes new collection action on Firestore rows', async () => {
    const onCreateCollection = vi.fn();
    render(
      <AccountTree
        filterValue=''
        items={[{
          id: 'firestore:emu',
          kind: 'firestore',
          label: 'Firestore',
          depth: 0,
          hasChildren: true,
          expanded: false,
          canCreateCollection: true,
        }]}
        onAddProject={() => {}}
        onCreateCollection={onCreateCollection}
        onFilterChange={() => {}}
        onOpenItem={() => {}}
        onRefreshItem={() => {}}
        onRemoveItem={() => {}}
        onSelectItem={() => {}}
        onToggleItem={() => {}}
      />,
    );

    expect(screen.queryByText('New collection')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New collection in Firestore' }));
    expect(onCreateCollection).toHaveBeenCalledWith('firestore:emu');

    fireEvent.contextMenu(screen.getByText('Firestore'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New collection' }));

    expect(onCreateCollection).toHaveBeenCalledTimes(2);
  });

  it('AccountTree hides new collection action until Firestore roots load', () => {
    render(
      <AccountTree
        filterValue=''
        items={[{
          id: 'firestore:emu',
          kind: 'firestore',
          label: 'Firestore',
          depth: 0,
          hasChildren: true,
          expanded: false,
        }]}
        onAddProject={() => {}}
        onCreateCollection={() => {}}
        onFilterChange={() => {}}
        onOpenItem={() => {}}
        onRefreshItem={() => {}}
        onRemoveItem={() => {}}
        onSelectItem={() => {}}
        onToggleItem={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'New collection in Firestore' })).toBeNull();
  });

  it('WorkspaceTabStrip switches and closes tabs', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <WorkspaceTabStrip
          activeTabId='tab-firestore'
          projects={projects}
          tabs={[
            { id: 'tab-firestore', kind: 'firestore-query', title: 'orders', connectionId: 'emu' },
            { id: 'tab-auth', kind: 'auth-users', title: 'Auth', connectionId: 'emu' },
          ]}
          onCloseAllTabs={() => {}}
          onCloseOtherTabs={() => {}}
          onCloseTab={onCloseTab}
          onCloseTabsToLeft={() => {}}
          onCloseTabsToRight={() => {}}
          onDuplicateTab={() => {}}
          onReorderTabs={() => {}}
          onSelectTab={onSelectTab}
          onSortByProject={() => {}}
        />
      </div>,
    );

    fireEvent.click(screen.getByText('Auth'));
    const closeAuthButton = screen.getByRole('button', { name: 'Close Auth' });
    fireEvent.pointerDown(closeAuthButton);
    fireEvent.click(closeAuthButton);

    expect(screen.queryByRole('button', { name: 'Scroll tabs left' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scroll tabs right' })).toBeNull();
    expect(onSelectTab).toHaveBeenCalledWith('tab-auth');
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onCloseTab).toHaveBeenCalledWith('tab-auth');
  });

  it('WorkspaceTabStrip shows scroll controls only when tabs overflow', async () => {
    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function scrollWidth(this: HTMLElement) {
        return this.getAttribute('role') === 'tablist' ? 900 : 0;
      });
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function clientWidth(this: HTMLElement) {
        return this.getAttribute('role') === 'tablist' ? 300 : 0;
      });
    const originalScrollBy = HTMLElement.prototype.scrollBy;
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
      configurable: true,
      value: scrollBy,
    });

    try {
      render(
        <WorkspaceTabStrip
          activeTabId='tab-1'
          projects={projects}
          tabs={Array.from({ length: 8 }, (_, index) => ({
            id: `tab-${index + 1}`,
            kind: 'firestore-query',
            title: `orders-${index + 1}`,
            connectionId: 'emu',
          }))}
          onCloseAllTabs={() => {}}
          onCloseOtherTabs={() => {}}
          onCloseTab={() => {}}
          onCloseTabsToLeft={() => {}}
          onCloseTabsToRight={() => {}}
          onDuplicateTab={() => {}}
          onReorderTabs={() => {}}
          onSelectTab={() => {}}
          onSortByProject={() => {}}
        />,
      );

      const left = await screen.findByRole('button', { name: 'Scroll tabs left' });
      const right = screen.getByRole('button', { name: 'Scroll tabs right' });
      expect((left as HTMLButtonElement).disabled).toBe(true);
      expect((right as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(right);
      await waitFor(() =>
        expect(scrollBy).toHaveBeenCalledWith({
          behavior: 'smooth',
          left: 210,
        })
      );
    } finally {
      scrollWidthSpy.mockRestore();
      clientWidthSpy.mockRestore();
      if (originalScrollBy) {
        Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
          configurable: true,
          value: originalScrollBy,
        });
      } else {
        delete (HTMLElement.prototype as { scrollBy?: unknown; }).scrollBy;
      }
    }
  });

  it('FirestoreQuerySurface selects rows, opens editor, and renders nested subcollection docs', async () => {
    const onSelectDocument = vi.fn();
    const onSaveDocument = vi.fn();
    const selectedDocument = documents[0]!;
    renderWithAppearance(
      <FirestoreQuerySurface
        draft={draft}
        hasMore
        rows={documents}
        selectedDocument={selectedDocument}
        onDraftEdit={() => {}}
        onLoadMore={() => {}}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSaveDocument={onSaveDocument}
        onSelectDocument={onSelectDocument}
      />,
    );

    const orderCell = screen.getAllByText('ord_1024')[0]!;
    fireEvent.click(orderCell);
    expect(onSelectDocument).toHaveBeenCalledWith('orders/ord_1024');

    const treeTab = screen.getByRole('tab', { name: /Tree/ });
    fireEvent.mouseDown(treeTab, { button: 0, ctrlKey: false });
    expect(screen.queryByText('evt_created')).toBeNull();
    fireEvent.click(screen.getAllByText('Subcollections')[0]!);
    fireEvent.click(screen.getAllByText('events')[0]!);
    expect(await screen.findByText('evt_created')).toBeTruthy();

    const tableTab = screen.getByRole('tab', { name: /Table/ });
    fireEvent.mouseDown(tableTab, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(treeTab, { button: 0, ctrlKey: false });
    expect(await screen.findByText('evt_created')).toBeTruthy();

    fireEvent.mouseDown(tableTab, { button: 0, ctrlKey: false });
    fireEvent.doubleClick(screen.getAllByText('ord_1024')[0]!);
    expect(await screen.findByRole('dialog', { name: 'Edit document JSON' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveDocument).toHaveBeenCalledWith(
      'orders/ord_1024',
      expect.objectContaining({ status: 'paid' }),
      undefined,
    );
  });

  it('FirestoreQuerySurface renders encoded Firestore values as typed cells', () => {
    renderWithAppearance(
      <FirestoreQuerySurface
        draft={draft}
        hasMore={false}
        rows={documents}
        onDraftEdit={() => {}}
        onLoadMore={() => {}}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSelectDocument={() => {}}
      />,
    );

    expect(screen.queryByText('time')).toBeNull();
    expect(screen.getByText(expectedUserTimestamp(encodedUpdatedAt.value))).toBeTruthy();
    expect(screen.getByText('geo')).toBeTruthy();
    expect(screen.getByText('-36.8485, 174.7633')).toBeTruthy();
    expect(screen.getByText('ref')).toBeTruthy();
    expect(screen.getByText('customers/cus_ada')).toBeTruthy();
    expect(screen.queryByText(/__type__/)).toBeNull();
  });

  it('FirestoreQuerySurface persists field metadata from loaded rows', async () => {
    const settings = new MockSettingsRepository();
    renderWithAppearance(
      <FirestoreQuerySurface
        draft={draft}
        hasMore={false}
        rows={documents}
        settings={settings}
        onDraftEdit={() => {}}
        onLoadMore={() => {}}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSelectDocument={() => {}}
      />,
    );

    await waitFor(async () => {
      const snapshot = await settings.load();
      expect(snapshot.firestoreFieldCatalogs.orders).toEqual(expect.arrayContaining([
        { count: 2, field: 'status', types: ['string'] },
        { count: 1, field: 'tags', types: ['array<string>'] },
        { count: 1, field: 'updatedAt', types: ['timestamp'] },
      ]));
    });
  });

  it('FirestoreDocumentBrowser renders native Firestore values as scalar cells', () => {
    const nativeUpdatedAt = new FirestoreTimestamp('2026-04-24T09:30:12.058Z');
    renderWithAppearance(
      <div className='h-[640px]'>
        <FirestoreDocumentBrowser
          hasMore={false}
          queryPath='orders'
          resultView='table'
          rows={[{
            id: 'ord_native',
            path: 'orders/ord_native',
            data: {
              updatedAt: nativeUpdatedAt,
              deliveryLocation: new FirestoreGeoPoint(-36.8485, 174.7633),
              customerRef: new FirestoreReference('customers/cus_ada'),
            },
            hasSubcollections: false,
          }]}
          onLoadMore={() => {}}
          onResultViewChange={() => {}}
        />
      </div>,
    );

    expect(screen.queryByText('time')).toBeNull();
    expect(screen.getByText(expectedUserTimestamp(nativeUpdatedAt.isoString))).toBeTruthy();
    expect(screen.getByText('geo')).toBeTruthy();
    expect(screen.getByText('-36.8485, 174.7633')).toBeTruthy();
    expect(screen.getByText('ref')).toBeTruthy();
    expect(screen.getByText('customers/cus_ada')).toBeTruthy();
    expect(screen.queryByText('isoString')).toBeNull();
  });

  it('FirestoreQuerySurface lazy loads subcollections from result rows', async () => {
    const onLoadSubcollections = vi.fn().mockResolvedValue([
      { id: 'events', path: 'orders/ord_lazy/events' },
    ]);
    renderWithAppearance(
      <FirestoreQuerySurface
        draft={draft}
        hasMore={false}
        rows={[{
          id: 'ord_lazy',
          path: 'orders/ord_lazy',
          data: { status: 'paid' },
          hasSubcollections: true,
        }]}
        onDraftEdit={() => {}}
        onLoadMore={() => {}}
        onLoadSubcollections={onLoadSubcollections}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSelectDocument={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    await waitFor(() => expect(onLoadSubcollections).toHaveBeenCalledWith('orders/ord_lazy'));
    expect(await screen.findByRole('button', { name: /events/ })).toBeTruthy();
  });

  it('FirestoreQuerySurface lazy loads subcollections when tree documents expand', async () => {
    const onLoadSubcollections = vi.fn().mockResolvedValue([
      { id: 'events', path: 'orders/ord_lazy/events' },
    ]);
    renderWithAppearance(
      <FirestoreQuerySurface
        draft={draft}
        hasMore={false}
        rows={[{
          id: 'ord_lazy',
          path: 'orders/ord_lazy',
          data: { status: 'paid' },
          hasSubcollections: true,
        }]}
        onDraftEdit={() => {}}
        onLoadMore={() => {}}
        onLoadSubcollections={onLoadSubcollections}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSelectDocument={() => {}}
      />,
    );

    const treeTab = screen.getByRole('tab', { name: /Tree/ });
    fireEvent.mouseDown(treeTab, { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByText('ord_lazy'));
    fireEvent.click(screen.getByText('ord_lazy'));

    await waitFor(() => expect(onLoadSubcollections).toHaveBeenCalledWith('orders/ord_lazy'));
    expect(await screen.findByText('events')).toBeTruthy();
  });

  it('FirestoreDocumentBrowser caps subcollection chips and opens collection paths', () => {
    const onOpenDocumentInNewTab = vi.fn();
    const subcollections = Array.from({ length: 12 }, (_, index) => ({
      id: `sub_${String(index).padStart(2, '0')}`,
      path: `orders/ord_chips/sub_${String(index).padStart(2, '0')}`,
    }));
    renderWithAppearance(
      <div className='h-[640px]'>
        <FirestoreDocumentBrowser
          hasMore={false}
          queryPath='orders'
          resultView='table'
          rows={[{
            id: 'ord_chips',
            path: 'orders/ord_chips',
            data: { status: 'paid' },
            hasSubcollections: true,
            subcollections,
          }]}
          onLoadMore={() => {}}
          onOpenDocumentInNewTab={onOpenDocumentInNewTab}
          onResultViewChange={() => {}}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /sub_00/ }));

    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sub_10/ })).toBeNull();
    expect(onOpenDocumentInNewTab).toHaveBeenCalledWith('orders/ord_chips/sub_00');
  });

  it('FirestoreDocumentBrowser groups tree fields and subcollections without count rows', () => {
    renderWithAppearance(
      <div className='h-[640px]'>
        <FirestoreDocumentBrowser
          hasMore={false}
          queryPath='orders'
          resultView='tree'
          rows={[{
            id: 'ord_tree',
            path: 'orders/ord_tree',
            data: { team: 'Wanaka' },
            hasSubcollections: true,
            subcollections: [{ id: 'skiers', path: 'orders/ord_tree/skiers', documentCount: 3 }],
          }]}
          onLoadMore={() => {}}
          onOpenDocumentInNewTab={() => {}}
          onResultViewChange={() => {}}
        />
      </div>,
    );

    const tree = screen.getByRole('tree');
    expect(within(tree).getByText('Fields')).toBeTruthy();
    expect(within(tree).getByText('Subcollections')).toBeTruthy();
    fireEvent.click(within(tree).getByText('Subcollections'));

    expect(within(tree).getByText('skiers')).toBeTruthy();
    expect(within(tree).queryByText('Documents')).toBeNull();
    expect(within(tree).queryByText('count')).toBeNull();
  });

  it('FirestoreQuerySurface disables query controls and shows running state while loading', () => {
    renderWithAppearance(
      <FirestoreQuerySurface
        draft={draft}
        hasMore={false}
        isLoading
        rows={documents}
        onDraftEdit={() => {}}
        onLoadMore={() => {}}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSelectDocument={() => {}}
      />,
    );

    expect((screen.getByLabelText('Query path') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Result limit') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Filter 1 field') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Filter 1 operator') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Filter 1 value') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Sort field') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Sort direction') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Filter' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('JsQuerySurface renders run action, editor, logs, and streamed result cards', async () => {
    const onRun = vi.fn();
    renderWithAppearance(
      <JsQuerySurface
        result={scriptResult}
        source={JS_QUERY_SAMPLE_SOURCE}
        onCancel={() => {}}
        onRun={onRun}
        onSourceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('monaco')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('yield DocumentSnapshot')).toBeTruthy());
    fireEvent.click(screen.getByText('yield QuerySnapshot'));
    expect(await screen.findByRole('tab', { name: /Tree/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Logs/ })).toBeTruthy();
  });

  it('JsQuerySurface switches Run to Cancel while running', () => {
    const onCancel = vi.fn();
    renderWithAppearance(
      <JsQuerySurface
        isRunning
        result={null}
        source={JS_QUERY_SAMPLE_SOURCE}
        onCancel={onCancel}
        onRun={() => {}}
        onSourceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText(/elapsed/)).toBeTruthy();
    expect(screen.getByTestId('monaco')).toHaveProperty('readOnly', true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('JsQuerySurface formats completed durations with millisecond precision', () => {
    renderWithAppearance(
      <JsQuerySurface
        result={{ ...scriptResult, durationMs: 1234 }}
        source={JS_QUERY_SAMPLE_SOURCE}
        onCancel={() => {}}
        onRun={() => {}}
        onSourceChange={() => {}}
      />,
    );

    expect(screen.getByText('1.234s').getAttribute('title')).toBe('1234ms');
  });
});
