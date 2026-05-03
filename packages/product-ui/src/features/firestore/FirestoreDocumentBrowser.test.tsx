import type { FirestoreDocumentResult, SettingsRepository } from '@firebase-desk/repo-contracts';
import { MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FirestoreDocumentBrowser } from './FirestoreDocumentBrowser.tsx';
import type { SubcollectionLoadState } from './resultModel.tsx';
import type { FirestoreResultView } from './types.ts';

vi.mock('../../hooks/useMediaQuery.ts', () => ({
  useMediaQuery: () => true,
}));

vi.mock('@firebase-desk/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@firebase-desk/ui')>();
  return {
    ...actual,
    ResizablePanelGroup: ({ children }: { readonly children: ReactNode; }) => <div>{children}</div>,
    ResizablePanel: (
      {
        children,
        defaultSize,
        onResize,
      }: {
        readonly children: ReactNode;
        readonly defaultSize?: string | number | undefined;
        readonly onResize?: (
          size: { readonly inPixels: number; readonly percentage: number; },
        ) => void;
      },
    ) => (
      <div data-testid={`panel-${String(defaultSize ?? 'auto')}`}>
        <button
          type='button'
          onClick={() => onResize?.({ inPixels: 512, percentage: 30 })}
        >
          resize {String(defaultSize ?? 'auto')}
        </button>
        {children}
      </div>
    ),
    ResizableHandle: () => null,
  };
});

vi.mock('./ResultPanel.tsx', () => ({
  ResultPanel: (
    {
      onLoadSubcollections,
      rows,
    }: {
      readonly onLoadSubcollections?: ((documentPath: string) => void) | undefined;
      readonly rows: ReadonlyArray<FirestoreDocumentResult>;
      readonly subcollectionStates: Readonly<Record<string, SubcollectionLoadState>>;
    },
  ) => (
    <div>
      <pre data-testid='rows'>{JSON.stringify(rows)}</pre>
      <button type='button' onClick={() => onLoadSubcollections?.('orders/ord_1')}>
        load subcollections
      </button>
    </div>
  ),
}));

vi.mock('./ResultOverviewPanel.tsx', () => ({
  OverviewCollapseStrip: () => <div>collapsed</div>,
  ResultContextPanel: (
    {
      resultView,
      selectedDocument,
    }: {
      readonly resultView: FirestoreResultView;
      readonly selectedDocument: FirestoreDocumentResult | null;
    },
  ) => <div data-testid='overview'>{resultView}:{selectedDocument?.path ?? 'none'}</div>,
}));

describe('FirestoreDocumentBrowser', () => {
  it('loads and merges lazy subcollections', async () => {
    const onLoadSubcollections = vi.fn().mockResolvedValue([
      { id: 'events', path: 'orders/ord_1/events' },
    ]);

    render(
      <FirestoreDocumentBrowser
        hasMore={false}
        queryPath='orders'
        resultView='table'
        rows={[{
          id: 'ord_1',
          path: 'orders/ord_1',
          data: {},
          hasSubcollections: true,
        }]}
        selectedDocumentPath='orders/ord_1'
        onLoadMore={() => {}}
        onLoadSubcollections={onLoadSubcollections}
        onResultViewChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'load subcollections' }));

    await waitFor(() =>
      expect(screen.getByTestId('rows').textContent).toContain('orders/ord_1/events')
    );
    expect(onLoadSubcollections).toHaveBeenCalledWith('orders/ord_1');
    expect(screen.getByTestId('overview').textContent).toBe('table:orders/ord_1');
  });

  it('restores and saves the inspector pane width', async () => {
    const settings = new MockSettingsRepository();
    await settings.save({ inspectorWidth: 444 });
    const save = vi.spyOn(settings, 'save');

    render(
      <FirestoreDocumentBrowser
        hasMore={false}
        queryPath='orders'
        resultView='table'
        rows={[]}
        settings={settings}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('panel-444px')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'resize 444px' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ inspectorWidth: 512 }));
  });

  it('keeps a user resize when settings load resolves late', async () => {
    const snapshotSource = new MockSettingsRepository();
    await snapshotSource.save({ inspectorWidth: 444 });
    const load = deferred<Awaited<ReturnType<SettingsRepository['load']>>>();
    const settings: SettingsRepository = {
      load: vi.fn(() => load.promise),
      save: vi.fn(async () => await snapshotSource.load()),
      getHotkeyOverrides: vi.fn(async () => ({})),
      setHotkeyOverrides: vi.fn(async () => {}),
    };

    render(
      <FirestoreDocumentBrowser
        hasMore={false}
        queryPath='orders'
        resultView='table'
        rows={[]}
        settings={settings}
        onLoadMore={() => {}}
        onResultViewChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'resize 360px' }));
    await waitFor(() => expect(screen.getByTestId('panel-512px')).toBeTruthy());

    load.resolve(await snapshotSource.load());
    await Promise.resolve();

    expect(screen.queryByTestId('panel-444px')).toBeNull();
    expect(screen.getByTestId('panel-512px')).toBeTruthy();
  });
});

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
