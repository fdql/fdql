import { HotkeysProvider } from '@firebase-desk/hotkeys';
import { AppearanceProvider } from '@firebase-desk/product-ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.tsx';
import {
  createMockRepositories,
  RepositoryProvider,
  type RepositorySet,
} from './RepositoryProvider.tsx';
import { selectionActions } from './stores/selectionStore.ts';
import { tabActions } from './stores/tabsStore.ts';

const resizablePanelHarness = vi.hoisted(() => ({
  handles: [] as Array<{
    readonly collapse: ReturnType<typeof vi.fn>;
    readonly expand: ReturnType<typeof vi.fn>;
    readonly getSize: ReturnType<typeof vi.fn>;
    readonly isCollapsed: ReturnType<typeof vi.fn>;
    readonly resize: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@firebase-desk/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@firebase-desk/ui')>();
  const React = await import('react');
  return {
    ...actual,
    ResizableHandle: ({ className }: { readonly className?: string; }) => (
      <div className={className} role='separator' />
    ),
    ResizablePanel: (
      {
        children,
        className,
        panelRef,
      }: {
        readonly children: import('react').ReactNode;
        readonly className?: string;
        readonly panelRef?: ((handle: unknown | null) => void) | undefined;
      },
    ) => {
      const handleRef = React.useRef<
        {
          readonly collapse: ReturnType<typeof vi.fn>;
          readonly expand: ReturnType<typeof vi.fn>;
          readonly getSize: ReturnType<typeof vi.fn>;
          readonly isCollapsed: ReturnType<typeof vi.fn>;
          readonly resize: ReturnType<typeof vi.fn>;
        } | null
      >(null);
      if (!handleRef.current) {
        let collapsed = false;
        handleRef.current = {
          collapse: vi.fn(() => {
            collapsed = true;
          }),
          expand: vi.fn(() => {
            collapsed = false;
          }),
          getSize: vi.fn(() => ({
            asPercentage: collapsed ? 0 : 30,
            inPixels: collapsed ? 36 : 320,
          })),
          isCollapsed: vi.fn(() => collapsed),
          resize: vi.fn(() => {
            collapsed = false;
          }),
        };
        resizablePanelHarness.handles.push(handleRef.current);
      }
      React.useLayoutEffect(() => {
        panelRef?.(handleRef.current);
        return () => panelRef?.(null);
      }, [panelRef]);
      return <div className={className}>{children}</div>;
    },
    ResizablePanelGroup: (
      {
        children,
        className,
      }: { readonly children: import('react').ReactNode; readonly className?: string; },
    ) => <div className={className}>{children}</div>,
  };
});

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
      aria-label='Code editor'
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
  loader: { config: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tabActions.reset();
  selectionActions.reset();
  resizablePanelHarness.handles.length = 0;
});

type InitialTab = Parameters<typeof tabActions.openTab>[0];

describe('desktop AppShell', () => {
  it('renders app chrome with no active tab', async () => {
    const repositories = createMockRepositories();
    const listUsers = vi.spyOn(repositories.auth, 'listUsers');
    const runQuery = vi.spyOn(repositories.firestore, 'runQuery');

    renderShell({ repositories });

    expect((await screen.findAllByText('No tab')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeTruthy();
    expect(listUsers).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('opens the add account dialog from the header', async () => {
    renderShell();

    const addAccountButton = (await screen.findAllByRole('button', { name: 'Add account' }))[0];
    expect(addAccountButton).toBeDefined();
    fireEvent.click(addAccountButton!);

    expect(screen.getByRole('dialog', { name: 'Add Firebase Account' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Service account' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Local emulator' })).toBeTruthy();
  });

  it('renders the active project in the workspace chrome', async () => {
    renderShell({ initialTab: { kind: 'auth-users', connectionId: 'emu' } });

    expect((await screen.findAllByText('Local Emulator')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('demo-local').length).toBeGreaterThan(0);
    expect(screen.getAllByText('emulator').length).toBeGreaterThan(0);
  });

  it('expands the sidebar panel from the collapsed rail', async () => {
    renderShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
    const sidebarPanel = resizablePanelHarness.handles[0];

    expect(sidebarPanel?.collapse).toHaveBeenCalledTimes(1);

    sidebarPanel?.getSize.mockReturnValue({ asPercentage: 3, inPixels: 40 });
    fireEvent.click(await screen.findByRole('button', { name: 'Expand sidebar' }));

    expect(sidebarPanel?.expand).toHaveBeenCalledTimes(1);
    expect(sidebarPanel?.resize).toHaveBeenCalledWith('320px');
  });
});

function renderShell(
  {
    dataMode = 'mock',
    initialTab,
    repositories = createMockRepositories(),
  }: {
    readonly dataMode?: 'live' | 'mock';
    readonly initialTab?: InitialTab;
    readonly repositories?: RepositorySet;
  } = {},
) {
  tabActions.reset();
  selectionActions.reset();
  const loadSettings = repositories.settings.load.bind(repositories.settings);
  vi.spyOn(repositories.settings, 'load').mockImplementation(async () => ({
    ...(await loadSettings()),
    firstRunGuide: { completedAt: '2026-01-01T00:00:00.000Z' },
  }));
  if (initialTab) tabActions.openTab(initialTab);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  render(
    <RepositoryProvider repositories={repositories}>
      <HotkeysProvider settings={repositories.settings}>
        <AppearanceProvider settings={repositories.settings}>
          <AppShell appVersion='0.1.0' dataMode={dataMode} />
        </AppearanceProvider>
      </HotkeysProvider>
    </RepositoryProvider>,
  );
}
