import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceTabStrip } from './WorkspaceTabStrip.tsx';

const projects: ReadonlyArray<ProjectSummary> = [{
  id: 'emu',
  name: 'Local emulator',
  projectId: 'demo-local',
  target: 'emulator',
  emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
  hasCredential: false,
  credentialEncrypted: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}];

function renderStrip(overrides: Partial<Parameters<typeof WorkspaceTabStrip>[0]> = {}) {
  const props: Parameters<typeof WorkspaceTabStrip>[0] = {
    activeTabId: 'tab-firestore',
    projects,
    tabs: [
      { id: 'tab-firestore', kind: 'firestore-query', title: 'orders', connectionId: 'emu' },
      { id: 'tab-auth', kind: 'auth-users', title: 'Auth', connectionId: 'emu' },
    ],
    onCloseAllTabs: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseTabsToLeft: vi.fn(),
    onCloseTabsToRight: vi.fn(),
    onDuplicateTab: vi.fn(),
    onReorderTabs: vi.fn(),
    onSelectTab: vi.fn(),
    onSortByProject: vi.fn(),
    ...overrides,
  };
  render(<WorkspaceTabStrip {...props} />);
  return props;
}

describe('WorkspaceTabStrip', () => {
  it('renders a consistent icon tab context menu without switch action', async () => {
    const props = renderStrip();

    fireEvent.contextMenu(screen.getByText('orders'));

    const menu = await screen.findByRole('menu');
    expect(menu.className).toContain('min-w-52');
    expect(screen.queryByRole('menuitem', { name: /switch/i })).toBeNull();
    expect(within(menu).queryAllByRole('separator').length).toBeGreaterThan(0);

    const labels = [
      'Close tab',
      'Close others',
      'Close tabs to left',
      'Close tabs to right',
      'Sort by connection',
      'Close all',
      'Duplicate tab',
    ];
    for (const label of labels) {
      const item = screen.getByRole('menuitem', { name: label });
      expect(item.querySelector('svg')).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    expect(props.onCloseTab).toHaveBeenCalledWith('tab-firestore');
  });

  it('duplicates a tab from the context menu', async () => {
    const props = renderStrip();

    fireEvent.contextMenu(screen.getByText('orders'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate tab' }));

    expect(props.onDuplicateTab).toHaveBeenCalledWith('tab-firestore');
  });
});
