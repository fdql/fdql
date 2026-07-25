import type { FirestoreDocumentResult } from '@firebase-desk/repo-contracts';
import { MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode, Ref } from 'react';
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
    ResizablePanelGroup: (
      {
        children,
        onLayoutChanged,
      }: {
        readonly children: ReactNode;
        readonly onLayoutChanged?: (() => void) | undefined;
      },
    ) => (
      <div>
        <button type='button' onClick={() => onLayoutChanged?.()}>
          layout changed
        </button>
        {children}
      </div>
    ),
    ResizablePanel: (
      {
        children,
        defaultSize,
        elementRef,
        maxSize,
        minSize,
        onResize,
      }: {
        readonly children: ReactNode;
        readonly defaultSize?: string | number | undefined;
        readonly elementRef?: Ref<HTMLDivElement> | undefined;
        readonly maxSize?: string | number | undefined;
        readonly minSize?: string | number | undefined;
        readonly onResize?: (
          size: { readonly inPixels: number; readonly percentage: number; },
        ) => void;
      },
    ) => (
      <div
        data-max-size={String(maxSize ?? 'none')}
        data-min-size={String(minSize ?? 'none')}
        data-testid={`panel-${String(defaultSize ?? 'auto')}`}
        ref={(node) => {
          if (!node || !elementRef) return;
          node.getBoundingClientRect = () => ({
            bottom: 0,
            height: 0,
            left: 0,
            right: 512,
            top: 0,
            width: 512,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          });
          if (typeof elementRef === 'function') elementRef(node);
          else elementRef.current = node;
        }}
      >
        <button
          type='button'
          onClick={() => onResize?.({ inPixels: 512, percentage: 30 })}
        >
          resize {String(defaultSize ?? 'auto')}
        </button>
        <button
          type='button'
          onClick={() => onResize?.({ inPixels: 42, percentage: 4 })}
        >
          collapse {String(defaultSize ?? 'auto')}
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

  it('reports per-tab inspector width changes without saving global settings', async () => {
    const settings = new MockSettingsRepository();
    await settings.save({ inspectorWidth: 444 });
    const save = vi.spyOn(settings, 'save');
    const onInspectorWidthChange = vi.fn();

    render(
      <FirestoreDocumentBrowser
        hasMore={false}
        inspectorWidth={444}
        queryPath='orders'
        resultView='table'
        rows={[]}
        settings={settings}
        onLoadMore={() => {}}
        onInspectorWidthChange={onInspectorWidthChange}
        onResultViewChange={() => {}}
      />,
    );

    expect(screen.getByTestId('panel-444px').getAttribute('data-max-size')).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'layout changed' }));

    expect(onInspectorWidthChange).toHaveBeenCalledWith(512);
    expect(save).not.toHaveBeenCalled();
  });

  it('collapses the result overview when resized to the rail', () => {
    const onInspectorOverviewCollapsedChange = vi.fn();

    render(
      <FirestoreDocumentBrowser
        hasMore={false}
        inspectorUi={{
          overviewCollapsed: false,
          resultTreeExpandedIds: null,
          sections: {
            fieldsInResults: false,
            jsonContext: true,
            selectionPreview: true,
          },
          selectionPreviewExpandedPathsByDocumentPath: {},
        }}
        inspectorWidth={360}
        queryPath='orders'
        resultView='table'
        rows={[]}
        onLoadMore={() => {}}
        onInspectorOverviewCollapsedChange={onInspectorOverviewCollapsedChange}
        onResultViewChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'collapse 360px' }));

    expect(onInspectorOverviewCollapsedChange).toHaveBeenCalledWith(true);
  });
});
