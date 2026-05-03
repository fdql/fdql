import { AUTH_USERS, MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../../appearance/AppearanceProvider.tsx';
import { AuthUsersSurface } from './AuthUsersSurface.tsx';

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

describe('AuthUsersSurface', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders provided users, selects users, and exposes Load more', () => {
    const onSelectUser = vi.fn();
    const onLoadMore = vi.fn();
    render(
      <AuthUsersSurface
        filterValue='grace@example.com'
        hasMore
        users={[AUTH_USERS[1]!]}
        onFilterChange={() => {}}
        onLoadMore={onLoadMore}
        onSelectUser={onSelectUser}
      />,
    );

    expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    fireEvent.click(screen.getAllByText('Grace Hopper')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(onSelectUser).toHaveBeenCalledWith('u_grace');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows loading state before users arrive', () => {
    render(
      <AuthUsersSurface
        filterValue=''
        hasMore={false}
        isLoading
        users={[]}
        onFilterChange={() => {}}
        onLoadMore={() => {}}
        onSelectUser={() => {}}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Loading users');
    expect(screen.queryByText('No users')).toBeNull();
  });

  it('edits custom claims JSON', async () => {
    const onSaveCustomClaims = vi.fn();
    renderWithAppearance(
      <AuthUsersSurface
        filterValue=''
        hasMore={false}
        selectedUserId='u_ada'
        users={[AUTH_USERS[0]!]}
        onFilterChange={() => {}}
        onLoadMore={() => {}}
        onSaveCustomClaims={onSaveCustomClaims}
        onSelectUser={() => {}}
      />,
    );

    expect(screen.getByText((content) => content.includes('"role": "admin"'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Custom claims' })).toBeTruthy();
    fireEvent.change(await screen.findByTestId('monaco'), {
      target: { value: '{ "role": "owner" }' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onSaveCustomClaims).toHaveBeenCalledWith('u_ada', { role: 'owner' })
    );
  });

  it('rejects non-object custom claims JSON', async () => {
    const onSaveCustomClaims = vi.fn();
    renderWithAppearance(
      <AuthUsersSurface
        filterValue=''
        hasMore={false}
        selectedUserId='u_ada'
        users={[AUTH_USERS[0]!]}
        onFilterChange={() => {}}
        onLoadMore={() => {}}
        onSaveCustomClaims={onSaveCustomClaims}
        onSelectUser={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByTestId('monaco'), { target: { value: '[]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Custom claims JSON must be an object.')).toBeTruthy();
    expect(onSaveCustomClaims).not.toHaveBeenCalled();
  });

  it('guards dirty custom claims before closing', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderWithAppearance(
      <AuthUsersSurface
        filterValue=''
        hasMore={false}
        selectedUserId='u_ada'
        users={[AUTH_USERS[0]!]}
        onFilterChange={() => {}}
        onLoadMore={() => {}}
        onSaveCustomClaims={() => {}}
        onSelectUser={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByTestId('monaco'), {
      target: { value: '{ "role": "owner" }' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved custom claims changes?');
    expect(screen.getByRole('dialog', { name: 'Custom claims' })).toBeTruthy();
  });

  it('surfaces custom claims save errors', async () => {
    const onSaveCustomClaims = vi.fn().mockRejectedValue(new Error('Claims rejected'));
    renderWithAppearance(
      <AuthUsersSurface
        filterValue=''
        hasMore={false}
        selectedUserId='u_ada'
        users={[AUTH_USERS[0]!]}
        onFilterChange={() => {}}
        onLoadMore={() => {}}
        onSaveCustomClaims={onSaveCustomClaims}
        onSelectUser={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByTestId('monaco'), {
      target: { value: '{ "role": "owner" }' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Claims rejected')).toBeTruthy();
  });
});

function renderWithAppearance(ui: ReactNode) {
  render(
    <AppearanceProvider settings={new MockSettingsRepository()}>
      {ui}
    </AppearanceProvider>,
  );
}
