import { HotkeysProvider } from '@firebase-desk/hotkeys';
import {
  AccountTree,
  AppearanceProvider,
  AuthUsersSurface,
  FirestoreQuerySurface,
  JS_QUERY_SAMPLE_SOURCE,
  JsQuerySurface,
  type JsQuerySurfaceProps,
  WorkspaceTabStrip,
} from '@firebase-desk/product-ui';
import { AUTH_USERS, COLLECTIONS, MockSettingsRepository } from '@firebase-desk/repo-mocks';
import type { Meta, StoryObj } from '@storybook/react';
import { type ComponentProps, useState } from 'react';

const settings = new MockSettingsRepository();
type FirestoreQueryDraft = ComponentProps<typeof FirestoreQuerySurface>['draft'];
const projects: ComponentProps<typeof WorkspaceTabStrip>['projects'] = [
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

interface StoryDocument {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
  readonly hasSubcollections: boolean;
  readonly subcollections?: ReadonlyArray<{
    readonly id: string;
    readonly path: string;
    readonly documentCount: number;
  }>;
}

const documents = storyDocuments('orders', 80).map((document) =>
  document.id === 'ord_1024'
    ? {
      id: document.id,
      path: document.path,
      data: document.data,
      hasSubcollections: true,
      subcollections: [{ id: 'events', path: 'orders/ord_1024/events', documentCount: 2 }],
    }
    : document
);
const selectedDocument = documents[0]!;
const scriptOrders = storyDocuments('orders', 80).filter((document) =>
  document.data['status'] === 'paid'
);
const scriptCustomers = storyDocuments('customers', 60);
const jsQueryResult: NonNullable<JsQuerySurfaceProps['result']> = {
  returnValue: scriptOrders,
  stream: [
    {
      id: 'yield-document-snapshot',
      label: 'yield DocumentSnapshot',
      badge: 'orders/ord_1024',
      view: 'json',
      value: scriptOrders[0],
    },
    {
      id: 'yield-collection-reference',
      label: 'yield CollectionReference',
      badge: 'customers',
      view: 'table',
      value: scriptCustomers,
    },
    {
      id: 'yield-query-snapshot',
      label: 'yield QuerySnapshot',
      badge: 'orders where status == paid',
      view: 'table',
      value: scriptOrders,
    },
    {
      id: 'return-query-snapshot',
      label: 'return QuerySnapshot',
      badge: 'final return',
      view: 'json',
      value: scriptOrders,
    },
  ],
  logs: [
    {
      level: 'info',
      message: 'Firebase Admin SDK ready for demo-local',
      timestamp: '2026-04-27T10:41:02.000Z',
    },
    {
      level: 'log',
      message: `Fetched ${scriptOrders.length} orders`,
      timestamp: '2026-04-27T10:41:03.000Z',
    },
    {
      level: 'info',
      message: 'Appended yield DocumentSnapshot to result stream',
      timestamp: '2026-04-27T10:41:03.000Z',
    },
    {
      level: 'info',
      message: 'Appended yield QuerySnapshot to result stream',
      timestamp: '2026-04-27T10:41:03.000Z',
    },
    {
      level: 'info',
      message: 'Appended return QuerySnapshot to result stream',
      timestamp: '2026-04-27T10:41:03.000Z',
    },
  ],
  errors: [],
  durationMs: 4,
};
const initialFirestoreDraft: FirestoreQueryDraft = {
  path: 'orders',
  filters: [{ id: 'filter-1', field: 'status', op: '==', value: 'paid' }],
  filterField: 'status',
  filterOp: '==',
  filterValue: 'paid',
  sortField: 'total',
  sortDirection: 'desc',
  limit: 25,
};

const meta: Meta = {
  title: 'Product UI/Feature Surfaces',
  decorators: [
    (Story) => (
      <HotkeysProvider settings={settings}>
        <AppearanceProvider settings={settings}>
          <Story />
        </AppearanceProvider>
      </HotkeysProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj;

export const AccountTreeDefault: Story = {
  render: () => (
    <div className='h-100 w-80 border border-border-subtle bg-bg-panel p-2'>
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
            id: 'firestore:emu',
            kind: 'firestore',
            label: 'Firestore',
            depth: 1,
            hasChildren: true,
            expanded: true,
            secondary: '3',
            canRefresh: true,
          },
          {
            id: 'collection:emu:orders',
            kind: 'collection',
            label: 'orders',
            depth: 2,
            expanded: false,
            hasChildren: false,
            secondary: String(documents.length),
          },
          {
            id: 'auth:emu',
            kind: 'auth',
            label: 'Authentication',
            depth: 1,
            hasChildren: false,
            expanded: false,
            secondary: 'users',
          },
          {
            id: 'script:emu',
            kind: 'script',
            label: 'JavaScript Query',
            depth: 1,
            hasChildren: false,
            expanded: false,
            secondary: 'SDK',
          },
        ]}
        onAddProject={() => {}}
        onFilterChange={() => {}}
        onOpenItem={() => {}}
        onRefreshItem={() => {}}
        onRemoveItem={() => {}}
        onSelectItem={() => {}}
        onToggleItem={() => {}}
      />
    </div>
  ),
};

export const WorkspaceTabStripDefault: Story = {
  render: () => (
    <WorkspaceTabStrip
      activeTabId='tab-firestore'
      projects={projects}
      tabs={[
        {
          id: 'tab-firestore',
          kind: 'firestore-query',
          title: 'orders',
          connectionId: 'emu',
          canGoBack: true,
        },
        { id: 'tab-auth', kind: 'auth-users', title: 'Auth', connectionId: 'emu' },
        { id: 'tab-js', kind: 'js-query', title: 'JS Query', connectionId: 'prod' },
      ]}
      onCloseAllTabs={() => {}}
      onCloseTab={() => {}}
      onCloseOtherTabs={() => {}}
      onCloseTabsToLeft={() => {}}
      onCloseTabsToRight={() => {}}
      onDuplicateTab={() => {}}
      onReorderTabs={() => {}}
      onSelectTab={() => {}}
      onSortByProject={() => {}}
    />
  ),
};

export const FirestoreQueryDefault: Story = {
  render: () => (
    <div className='h-170'>
      <FirestoreQueryStorySurface />
    </div>
  ),
};

function FirestoreQueryStorySurface() {
  const [draft, setDraft] = useState<FirestoreQueryDraft>(initialFirestoreDraft);
  const [rows, setRows] = useState(documents);
  const [selectedPath, setSelectedPath] = useState(selectedDocument.path);
  const selected = rows.find((row) => row.path === selectedPath) ?? rows[0] ?? null;
  return (
    <FirestoreQuerySurface
      draft={draft}
      hasMore
      rows={rows}
      selectedDocument={selected}
      selectedDocumentPath={selected?.path ?? null}
      settings={settings}
      onDraftChange={setDraft}
      onLoadMore={() => {}}
      onOpenDocumentInNewTab={() => {}}
      onReset={() => setDraft(initialFirestoreDraft)}
      onRun={() => {}}
      onDeleteDocument={(path, options) => {
        const deletedPaths = new Set([path, ...options.deleteDescendantDocumentPaths]);
        setRows((current) => current.filter((row) => !deletedPaths.has(row.path)));
        if (selectedPath === path) setSelectedPath('');
      }}
      onSaveDocument={(path, data) => {
        setRows((current) => current.map((row) => row.path === path ? { ...row, data } : row));
      }}
      onSelectDocument={setSelectedPath}
    />
  );
}

function storyDocuments(
  collectionPath: string,
  limit: number,
): ReadonlyArray<StoryDocument> {
  const collection = COLLECTIONS.find((item) => item.path === collectionPath);
  return (collection?.docs ?? []).slice(0, limit).map((document) => ({
    id: document.id,
    path: `${collectionPath}/${document.id}`,
    data: document.data,
    hasSubcollections: false,
  }));
}

export const AuthUsersDefault: Story = {
  render: () => (
    <div className='h-140'>
      <AuthUsersStorySurface />
    </div>
  ),
};

function AuthUsersStorySurface() {
  const [filterValue, setFilterValue] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>(AUTH_USERS[0].uid);
  const selectedUser = AUTH_USERS.find((user) => user.uid === selectedUserId) ?? AUTH_USERS[0];
  return (
    <AuthUsersSurface
      filterValue={filterValue}
      hasMore={false}
      selectedUser={selectedUser}
      selectedUserId={selectedUserId}
      users={AUTH_USERS}
      onFilterChange={setFilterValue}
      onLoadMore={() => {}}
      onSelectUser={setSelectedUserId}
    />
  );
}

export const JsQueryDefault: Story = {
  render: () => (
    <div className='h-155'>
      <JsQuerySurface
        result={jsQueryResult}
        source={JS_QUERY_SAMPLE_SOURCE}
        onCancel={() => {}}
        onRun={() => {}}
        onSourceChange={() => {}}
      />
    </div>
  ),
};
