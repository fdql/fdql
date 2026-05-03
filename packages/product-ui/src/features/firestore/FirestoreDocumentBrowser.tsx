import type { DensityName } from '@firebase-desk/design-tokens';
import type {
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import { cn, ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@firebase-desk/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';
import { messageFromError } from '../../shared/errors.ts';
import { type FieldEditTarget } from './fieldEditModel.ts';
import {
  findDocumentByPath,
  mergeLoadedSubcollections,
  type SubcollectionLoadState,
} from './resultModel.tsx';
import { OverviewCollapseStrip, ResultContextPanel } from './ResultOverviewPanel.tsx';
import { ResultPanel } from './ResultPanel.tsx';
import type { FirestoreResultView } from './types.ts';

type CollectionJobKind = 'copy' | 'delete' | 'duplicate' | 'export' | 'import';

const DEFAULT_INSPECTOR_WIDTH = 360;
const MIN_INSPECTOR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 520;

export interface FirestoreDocumentBrowserProps {
  readonly className?: string;
  readonly density?: DensityName | undefined;
  readonly errorMessage?: string | null;
  readonly hasMore: boolean;
  readonly header?: ReactNode;
  readonly isFetchingMore?: boolean;
  readonly isLoading?: boolean;
  readonly actionErrorMessage?: string | null;
  readonly actionNoticeMessage?: string | null;
  readonly onCreateDocument?: ((collectionPath: string) => void) | undefined;
  readonly onCollectionJob?:
    | ((kind: CollectionJobKind, collectionPath: string) => void)
    | undefined;
  readonly onDeleteDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
  readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
  readonly onEditDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
  readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
  readonly onLoadMore: () => void;
  readonly onLoadSubcollections?:
    | (
      (documentPath: string) => Promise<ReadonlyArray<FirestoreCollectionNode>>
    )
    | undefined;
  readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
  readonly onResultViewChange: (view: FirestoreResultView) => void;
  readonly onRefreshResults?: (() => void) | undefined;
  readonly onSelectDocument?: ((documentPath: string) => void) | undefined;
  readonly onSettingsError?: ((message: string) => void) | undefined;
  readonly onSetFieldValue?: ((target: FieldEditTarget, value: unknown) => void) | undefined;
  readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
  readonly queryPath: string;
  readonly resultView: FirestoreResultView;
  readonly resultsStale?: boolean;
  readonly rows: ReadonlyArray<FirestoreDocumentResult>;
  readonly selectedDocument?: FirestoreDocumentResult | null;
  readonly selectedDocumentPath?: string | null;
  readonly settings?: SettingsRepository | undefined;
}

export function FirestoreDocumentBrowser(
  {
    className,
    density,
    errorMessage = null,
    hasMore,
    header,
    actionErrorMessage = null,
    actionNoticeMessage = null,
    isFetchingMore = false,
    isLoading = false,
    onCreateDocument,
    onCollectionJob,
    onDeleteDocument,
    onDeleteField,
    onEditDocument,
    onEditField,
    onLoadMore,
    onLoadSubcollections,
    onOpenDocumentInNewTab,
    onResultViewChange,
    onRefreshResults,
    onSelectDocument,
    onSettingsError,
    onSetFieldValue,
    onSetFieldNull,
    queryPath,
    resultView,
    resultsStale = false,
    rows,
    selectedDocument = null,
    selectedDocumentPath = null,
    settings,
  }: FirestoreDocumentBrowserProps,
) {
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const [inspectorLayoutRevision, setInspectorLayoutRevision] = useState(0);
  const [subcollectionStates, setSubcollectionStates] = useState<
    Readonly<Record<string, SubcollectionLoadState>>
  >({});
  const useSplitLayout = useMediaQuery('(min-width: 1024px)');
  const rowsWithSubcollections = useMemo(
    () => rows.map((row) => mergeLoadedSubcollections(row, subcollectionStates[row.path])),
    [rows, subcollectionStates],
  );
  const selectedDocumentWithSubcollections = useMemo(() => {
    const fallback = mergeLoadedSubcollections(
      selectedDocument,
      selectedDocument ? subcollectionStates[selectedDocument.path] : undefined,
    );
    return selectedDocumentPath
      ? findDocumentByPath(rowsWithSubcollections, selectedDocumentPath) ?? fallback
      : fallback;
  }, [rowsWithSubcollections, selectedDocument, selectedDocumentPath, subcollectionStates]);

  useEffect(() => {
    if (!settings) {
      setInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
      setInspectorLayoutRevision((revision) => revision + 1);
      return;
    }
    let cancelled = false;
    settings.load().then((snapshot) => {
      if (cancelled) return;
      setInspectorWidth(clampInspectorWidth(snapshot.inspectorWidth));
      setInspectorLayoutRevision((revision) => revision + 1);
    }).catch((caught) => {
      if (!cancelled) {
        onSettingsError?.(messageFromError(caught, 'Could not load inspector layout settings.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onSettingsError, settings]);

  async function loadSubcollections(documentPath: string) {
    if (!onLoadSubcollections) return;
    setSubcollectionStates((current) => ({
      ...current,
      [documentPath]: { status: 'loading' },
    }));
    try {
      const items = await onLoadSubcollections(documentPath);
      setSubcollectionStates((current) => ({
        ...current,
        [documentPath]: { status: 'success', items },
      }));
    } catch (caught) {
      setSubcollectionStates((current) => ({
        ...current,
        [documentPath]: {
          status: 'error',
          errorMessage: messageFromError(caught, 'Could not load subcollections.'),
        },
      }));
    }
  }

  function saveInspectorWidth(width: number) {
    const nextWidth = clampInspectorWidth(width);
    setInspectorWidth(nextWidth);
    if (!settings) return;
    void settings.save({ inspectorWidth: nextWidth }).catch((caught) => {
      onSettingsError?.(messageFromError(caught, 'Could not save inspector layout settings.'));
    });
  }

  const mainColumn = (
    <div
      className={header
        ? 'grid h-full min-h-0 flex-1 self-stretch grid-rows-[auto_minmax(0,1fr)] gap-2'
        : 'grid h-full min-h-0 flex-1 self-stretch grid-rows-[minmax(0,1fr)]'}
    >
      {header}
      <ResultPanel
        density={density}
        hasMore={hasMore}
        errorMessage={errorMessage}
        isFetchingMore={isFetchingMore}
        isLoading={isLoading}
        actionErrorMessage={actionErrorMessage}
        actionNoticeMessage={actionNoticeMessage}
        queryPath={queryPath}
        resultView={resultView}
        resultsStale={resultsStale}
        rows={rowsWithSubcollections}
        selectedDocumentPath={selectedDocumentPath}
        settings={settings}
        subcollectionStates={subcollectionStates}
        onCollectionJob={onCollectionJob}
        onCreateDocument={onCreateDocument}
        onDeleteDocument={onDeleteDocument}
        onDeleteField={onDeleteField}
        onEditDocument={onEditDocument}
        onEditField={onEditField}
        onLoadMore={onLoadMore}
        onLoadSubcollections={onLoadSubcollections ? loadSubcollections : undefined}
        onOpenDocumentInNewTab={onOpenDocumentInNewTab}
        onResultViewChange={onResultViewChange}
        onRefreshResults={onRefreshResults}
        onSelectDocument={onSelectDocument}
        onSettingsError={onSettingsError}
        onSetFieldNull={onSetFieldNull}
      />
    </div>
  );

  const overviewPanel = overviewCollapsed
    ? <OverviewCollapseStrip onExpand={() => setOverviewCollapsed(false)} />
    : (
      <ResultContextPanel
        resultView={resultView}
        rows={rowsWithSubcollections}
        selectedDocument={selectedDocumentWithSubcollections}
        onCollapse={() => setOverviewCollapsed(true)}
        onDeleteDocument={onDeleteDocument}
        onDeleteField={onDeleteField}
        onEditDocument={onEditDocument}
        onEditField={onEditField}
        onOpenDocumentInNewTab={onOpenDocumentInNewTab}
        onSetFieldValue={onSetFieldValue}
        onSetFieldNull={onSetFieldNull}
      />
    );

  return (
    <div className={cn('h-full min-h-0', className)}>
      {useSplitLayout
        ? (
          <ResizablePanelGroup
            key={`${
              overviewCollapsed ? 'overview-collapsed' : 'overview-expanded'
            }:${inspectorLayoutRevision}`}
            direction='horizontal'
            className='h-full min-h-0'
          >
            <ResizablePanel className='flex h-full min-h-0 flex-col' minSize='420px'>
              {mainColumn}
            </ResizablePanel>
            <ResizableHandle className='mx-2 h-full w-px' />
            <ResizablePanel
              className='flex h-full min-h-0 flex-col'
              defaultSize={overviewCollapsed ? '42px' : `${inspectorWidth}px`}
              groupResizeBehavior='preserve-pixel-size'
              maxSize={overviewCollapsed ? '42px' : '520px'}
              minSize={overviewCollapsed ? '42px' : '280px'}
              onResize={(size) => {
                if (!overviewCollapsed) saveInspectorWidth(size.inPixels);
              }}
            >
              {overviewPanel}
            </ResizablePanel>
          </ResizablePanelGroup>
        )
        : (
          <div className='grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(220px,34%)] gap-2'>
            {mainColumn}
            {overviewPanel}
          </div>
        )}
    </div>
  );
}

function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_INSPECTOR_WIDTH;
  return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.round(width)));
}
