import type { DensityName } from '@firebase-desk/design-tokens';
import type { AuthUser } from '@firebase-desk/repo-contracts';
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  EmptyState,
  InlineAlert,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@firebase-desk/ui';
import { Pencil, ShieldCheck, UserRound, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CodeEditor } from '../../code-editor/CodeEditor.tsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';
import { messageFromError } from '../../shared/errors.ts';
import { confirmDiscardUnsavedChanges } from '../../shared/unsavedDialogGuard.ts';

export interface AuthUsersSurfaceProps {
  readonly density?: DensityName | undefined;
  readonly errorMessage?: string | null;
  readonly filterValue: string;
  readonly hasMore: boolean;
  readonly isFetchingMore?: boolean;
  readonly isLoading?: boolean;
  readonly onFilterChange: (value: string) => void;
  readonly onLoadMore: () => void;
  readonly onSaveCustomClaims?:
    | ((uid: string, claims: Record<string, unknown>) => Promise<void> | void)
    | undefined;
  readonly onSelectUser: (uid: string) => void;
  readonly selectedUser?: AuthUser | null;
  readonly selectedUserId?: string | null;
  readonly users: ReadonlyArray<AuthUser>;
}

export function AuthUsersSurface(
  {
    density: tableDensity,
    filterValue,
    errorMessage = null,
    hasMore,
    isFetchingMore = false,
    isLoading = false,
    onFilterChange,
    onLoadMore,
    onSaveCustomClaims,
    onSelectUser,
    selectedUser = null,
    selectedUserId = null,
    users,
  }: AuthUsersSurfaceProps,
) {
  const selectedVisibleUser = users.find((user) => user.uid === selectedUserId)
    ?? users[0]
    ?? selectedUser;
  const isWide = useMediaQuery('(min-width: 900px)');
  const direction = isWide ? 'horizontal' : 'vertical';

  return (
    <div className='h-full min-h-0 overflow-hidden p-2'>
      <ResizablePanelGroup
        key={direction}
        className='h-full min-h-0'
        direction={direction}
      >
        <ResizablePanel
          className='h-full'
          defaultSize={isWide ? '64%' : '58%'}
          minSize={isWide ? '460px' : '260px'}
        >
          <Panel className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
            <PanelHeader
              actions={
                <Input
                  aria-label='Filter users'
                  className='max-w-65'
                  placeholder='UID or email'
                  value={filterValue}
                  onChange={(event) => onFilterChange(event.currentTarget.value)}
                />
              }
            >
              <span className='flex min-w-0 items-center gap-2'>
                <Users size={15} aria-hidden='true' />
                <span className='truncate'>Users</span>
                <Badge>{isLoading ? 'loading' : `${users.length}`}</Badge>
              </span>
            </PanelHeader>
            <PanelBody className='min-h-0 p-0'>
              {errorMessage
                ? (
                  <div className='border-b border-border-subtle p-2'>
                    <InlineAlert variant='danger'>{errorMessage}</InlineAlert>
                  </div>
                )
                : null}
              <AuthUsersTable
                density={tableDensity}
                hasMore={hasMore}
                isFetchingMore={isFetchingMore}
                isLoading={isLoading}
                selectedUserId={selectedVisibleUser?.uid ?? null}
                users={users}
                onLoadMore={onLoadMore}
                onSelectUser={onSelectUser}
              />
            </PanelBody>
          </Panel>
        </ResizablePanel>
        <ResizableHandle className={isWide ? 'mx-2 h-full w-px' : 'my-2 h-px w-full'} />
        <ResizablePanel
          className='h-full'
          defaultSize={isWide ? '36%' : '42%'}
          minSize={isWide ? '300px' : '220px'}
        >
          <AuthUserDetail
            user={selectedVisibleUser ?? null}
            onSaveCustomClaims={onSaveCustomClaims}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

interface AuthUsersTableProps {
  readonly density?: DensityName | undefined;
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly isLoading: boolean;
  readonly onLoadMore: () => void;
  readonly onSelectUser: (uid: string) => void;
  readonly selectedUserId: string | null;
  readonly users: ReadonlyArray<AuthUser>;
}

type AuthUsersTableRow = { readonly kind: 'user'; readonly user: AuthUser; };

function AuthUsersTable(
  {
    density,
    hasMore,
    isFetchingMore,
    isLoading,
    onLoadMore,
    onSelectUser,
    selectedUserId,
    users,
  }: AuthUsersTableProps,
) {
  if (!users.length && isLoading) {
    return (
      <LoadingState
        description='Fetching Authentication users for this project.'
        title='Loading users'
      />
    );
  }

  if (!users.length) {
    return <EmptyState icon={<UserRound size={20} aria-hidden='true' />} title='No users' />;
  }

  const rows: ReadonlyArray<AuthUsersTableRow> = users.map((user) => ({
    kind: 'user',
    user,
  }));

  const columns: ReadonlyArray<DataTableColumn<AuthUsersTableRow>> = [
    {
      id: 'uid',
      header: 'UID',
      width: 150,
      cell: ({ row }) => <span className='font-mono text-xs'>{row.original.user.uid}</span>,
    },
    {
      id: 'email',
      header: 'Email',
      cell: ({ row }) => row.original.user.email ?? 'No email',
    },
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => row.original.user.displayName ?? 'No name',
    },
    {
      id: 'provider',
      header: 'Provider',
      width: 140,
      cell: ({ row }) => row.original.user.provider,
    },
    {
      id: 'status',
      header: 'Status',
      width: 110,
      cell: ({ row }) =>
        row.original.user.disabled
          ? 'disabled'
          : 'active',
    },
  ];

  return (
    <div className='grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]'>
      <DataTable
        columns={columns}
        data={rows}
        density={density}
        getRowId={(row) => row.user.uid}
        rowClassName={(row) =>
          row.user.uid === selectedUserId
            ? 'bg-action-selected shadow-[inset_2px_0_0_var(--color-action-primary)]'
            : undefined}
        selectedRowId={selectedUserId}
        onRowClick={(row) => onSelectUser(row.user.uid)}
      />
      {hasMore
        ? (
          <div className='border-t border-border-subtle bg-bg-panel px-3 py-2'>
            <Button disabled={isFetchingMore} variant='secondary' onClick={onLoadMore}>
              {isFetchingMore ? 'Loading' : 'Load more'}
            </Button>
          </div>
        )
        : null}
    </div>
  );
}

function LoadingState(
  { description, title }: { readonly description: string; readonly title: string; },
) {
  return (
    <div role='status' aria-live='polite' className='grid h-full place-items-center'>
      <EmptyState
        description={description}
        title={title}
      />
    </div>
  );
}

function AuthUserDetail(
  {
    onSaveCustomClaims,
    user,
  }: {
    readonly onSaveCustomClaims?:
      | ((uid: string, claims: Record<string, unknown>) => Promise<void> | void)
      | undefined;
    readonly user: AuthUser | null;
  },
) {
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    if (!user) setEditorOpen(false);
  }, [user]);

  return (
    <Panel className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
      <PanelHeader
        actions={user
          ? (
            <div className='flex items-center gap-2'>
              <Badge>claims</Badge>
              {onSaveCustomClaims
                ? (
                  <Button size='xs' variant='secondary' onClick={() => setEditorOpen(true)}>
                    <Pencil size={13} aria-hidden='true' />
                    Edit
                  </Button>
                )
                : null}
            </div>
          )
          : null}
      >
        <span className='flex min-w-0 items-center gap-2'>
          <ShieldCheck size={15} aria-hidden='true' />
          <span className='truncate'>User detail</span>
        </span>
      </PanelHeader>
      <PanelBody className='min-h-0 overflow-auto'>
        {user
          ? (
            <div className='grid content-start gap-3'>
              <div className='grid gap-2'>
                <DetailItem label='UID' value={user.uid} />
                <DetailItem label='Email' value={user.email ?? 'No email'} />
                <DetailItem label='Name' value={user.displayName ?? 'No name'} />
                <DetailItem label='Provider' value={user.provider} />
                <DetailItem label='Disabled' value={user.disabled ? 'Yes' : 'No'} />
              </div>
              <JsonPreview value={user.customClaims} />
            </div>
          )
          : (
            <EmptyState
              icon={<UserRound size={20} aria-hidden='true' />}
              title='No user selected'
            />
          )}
      </PanelBody>
      <ClaimsEditorModal
        open={editorOpen}
        user={user}
        onOpenChange={setEditorOpen}
        onSaveCustomClaims={onSaveCustomClaims}
      />
    </Panel>
  );
}

function DetailItem({ label, value }: { readonly label: string; readonly value: string; }) {
  return (
    <div className='grid grid-cols-[130px_minmax(0,1fr)] items-baseline gap-2 border-b border-dashed border-border-subtle py-1.5 last:border-b-0'>
      <span className='text-[11.5px] font-semibold uppercase tracking-normal text-text-muted'>
        {label}
      </span>
      <span className='min-w-0 select-text overflow-hidden text-ellipsis break-words font-medium text-text-primary'>
        {value}
      </span>
    </div>
  );
}

function JsonPreview({ value }: { readonly value: unknown; }) {
  return (
    <pre className='select-text overflow-auto rounded-md border border-border-subtle bg-bg-subtle p-3 font-mono text-xs leading-relaxed text-text-secondary'>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ClaimsEditorModal(
  {
    onOpenChange,
    onSaveCustomClaims,
    open,
    user,
  }: {
    readonly onOpenChange: (open: boolean) => void;
    readonly onSaveCustomClaims?:
      | ((uid: string, claims: Record<string, unknown>) => Promise<void> | void)
      | undefined;
    readonly open: boolean;
    readonly user: AuthUser | null;
  },
) {
  const [source, setSource] = useState('{}');
  const [baselineSource, setBaselineSource] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open && user) {
      const nextSource = JSON.stringify(user.customClaims, null, 2);
      setBaselineSource(nextSource);
      setSource(nextSource);
      setError(null);
      setIsSaving(false);
    }
  }, [open, user]);

  const hasUnsavedChanges = source !== baselineSource;

  function requestOpenChange(nextOpen: boolean) {
    if (
      !nextOpen && hasUnsavedChanges && !isSaving
      && !confirmDiscardUnsavedChanges('Discard unsaved custom claims changes?')
    ) return;
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        className='w-[min(680px,calc(100vw-32px))]'
        description={user?.uid ?? null}
        title='Custom claims'
      >
        <div className='h-[min(360px,55vh)] overflow-hidden rounded-md border border-border-subtle'>
          <CodeEditor
            ariaLabel='Custom claims JSON'
            language='json'
            value={source}
            onChange={setSource}
          />
        </div>
        {error ? <InlineAlert variant='danger'>{error}</InlineAlert> : null}
        <div className='flex justify-end gap-2'>
          <Button disabled={isSaving} variant='ghost' onClick={() => requestOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            variant='primary'
            onClick={async () => {
              if (!user || !onSaveCustomClaims) return;
              setIsSaving(true);
              setError(null);
              try {
                await onSaveCustomClaims(user.uid, parseClaimsJson(source));
                onOpenChange(false);
              } catch (caught) {
                setError(messageFromError(caught, 'Could not save custom claims.'));
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? 'Saving' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function parseClaimsJson(source: string): Record<string, unknown> {
  const value = JSON.parse(source) as unknown;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('Custom claims JSON must be an object.');
}
