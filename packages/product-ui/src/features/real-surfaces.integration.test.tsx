import type { FirestoreDocumentResult, FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import { AUTH_USERS, MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AppearanceProviderComponent =
  typeof import('../appearance/AppearanceProvider.tsx').AppearanceProvider;
type AuthUsersSurfaceComponent = typeof import('./auth/AuthUsersSurface.tsx').AuthUsersSurface;
type FirestoreQuerySurfaceComponent =
  typeof import('./firestore/FirestoreQuerySurface.tsx').FirestoreQuerySurface;

let AppearanceProvider: AppearanceProviderComponent;
let AuthUsersSurface: AuthUsersSurfaceComponent;
let FirestoreQuerySurface: FirestoreQuerySurfaceComponent;

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
      value,
    }: {
      readonly onChange?: (value: string) => void;
      readonly value: string;
    },
  ) => (
    <textarea
      data-testid='monaco'
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
  loader: { config: vi.fn() },
}));

describe('real feature surface integrations', () => {
  beforeAll(async () => {
    ({ AppearanceProvider } = await import('../appearance/AppearanceProvider.tsx'));
    ({ AuthUsersSurface } = await import('./auth/AuthUsersSurface.tsx'));
    ({ FirestoreQuerySurface } = await import('./firestore/FirestoreQuerySurface.tsx'));
  });

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

  it('AuthUsersSurface uses the real DataTable grid and row selection', () => {
    const onSelectUser = vi.fn();

    renderWithAppearance(
      <AuthUsersSurface
        filterValue=''
        hasMore={false}
        selectedUserId='u_ada'
        users={[AUTH_USERS[0]!, AUTH_USERS[1]!]}
        onFilterChange={() => {}}
        onLoadMore={() => {}}
        onSelectUser={onSelectUser}
      />,
    );

    const grid = screen.getByRole('grid');
    expect(within(grid).getByRole('columnheader', { name: 'UID' })).toBeTruthy();
    fireEvent.click(within(grid).getByText('u_grace'));

    expect(onSelectUser).toHaveBeenCalledWith('u_grace');
    expect(within(grid).getAllByRole('row')[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('FirestoreQuerySurface uses real table and tree widgets', async () => {
    const onSelectDocument = vi.fn();
    renderWithAppearance(
      <FirestoreQuerySurface
        draft={draft}
        hasMore={false}
        rows={documents}
        onDraftEdit={() => {}}
        onLoadMore={() => {}}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSelectDocument={onSelectDocument}
      />,
    );

    const grid = screen.getByRole('grid');
    expect(within(grid).getByRole('columnheader', { name: /Document ID/ })).toBeTruthy();
    fireEvent.click(within(grid).getByText('ord_1024'));
    expect(onSelectDocument).toHaveBeenCalledWith('orders/ord_1024');

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Tree/ }), {
      button: 0,
      ctrlKey: false,
    });

    const tree = await screen.findByRole('tree');
    expect(within(tree).getByText('ord_1024')).toBeTruthy();
  });
});

function renderWithAppearance(ui: ReactNode) {
  render(
    <AppearanceProvider settings={new MockSettingsRepository()}>
      {ui}
    </AppearanceProvider>,
  );
}

const draft: FirestoreQueryDraft = {
  filterField: '',
  filterOp: '==',
  filterValue: '',
  filters: [],
  limit: 25,
  path: 'orders',
  sortDirection: 'desc',
  sortField: '',
};

const documents: ReadonlyArray<FirestoreDocumentResult> = [
  {
    data: { status: 'paid', total: 129.4 },
    hasSubcollections: true,
    id: 'ord_1024',
    path: 'orders/ord_1024',
    subcollections: [{ id: 'events', path: 'orders/ord_1024/events' }],
  },
  {
    data: { status: 'pending', total: 42 },
    hasSubcollections: false,
    id: 'ord_1025',
    path: 'orders/ord_1025',
  },
];
