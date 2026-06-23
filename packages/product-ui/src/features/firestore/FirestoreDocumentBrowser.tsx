import type { DensityName } from '@firebase-desk/design-tokens';
import type {
  FirestoreCollectionNode,
  FirestoreDocumentResult,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import { cn, ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@firebase-desk/ui';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';
import { messageFromError } from '../../shared/errors.ts';
import { type FieldEditTarget } from './fieldEditModel.ts';
import type { FirestoreInspectorSectionId, FirestoreInspectorUiState } from './inspectorState.ts';
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
const COLLAPSED_INSPECTOR_WIDTH = 42;
const MIN_INSPECTOR_WIDTH = 220;
const MIN_RESULTS_WIDTH = 360;
const defaultInspectorUi: FirestoreInspectorUiState = {
  overviewCollapsed: false,
  resultTreeExpandedIds: null,
  sections: {
    fieldsInResults: false,
    jsonContext: true,
    selectionPreview: true,
  },
  selectionPreviewExpandedPathsByDocumentPath: {},
};

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
  readonly inspectorUi?: FirestoreInspectorUiState | undefined;
  readonly inspectorWidth?: number | undefined;
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
  readonly onInspectorOverviewCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  readonly onInspectorSectionOpenChange?:
    | ((section: FirestoreInspectorSectionId, open: boolean) => void)
    | undefined;
  readonly onInspectorWidthChange?: ((width: number) => void) | undefined;
  readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
  readonly onResultViewChange: (view: FirestoreResultView) => void;
  readonly onResultTreeExpandedIdsChange?:
    | ((expandedIds: ReadonlyArray<string>) => void)
    | undefined;
  readonly onRefreshResults?: (() => void) | undefined;
  readonly onSelectDocument?: ((documentPath: string) => void) | undefined;
  readonly onSelectionPreviewExpandedPathsChange?:
    | ((documentPath: string, expandedPaths: ReadonlyArray<string>) => void)
    | undefined;
  readonly onSettingsError?: ((message: string) => void) | undefined;
  readonly onSetFieldValue?: ((target: FieldEditTarget, value: unknown) => void) | undefined;
  readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
  readonly queryPath: string;
  readonly resultView: FirestoreResultView;
  readonly resultsScopeKey?: string | undefined;
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
    inspectorUi,
    inspectorWidth: controlledInspectorWidth,
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
    onInspectorOverviewCollapsedChange,
    onInspectorSectionOpenChange,
    onInspectorWidthChange,
    onOpenDocumentInNewTab,
    onResultViewChange,
    onRefreshResults,
    onSelectDocument,
    onResultTreeExpandedIdsChange,
    onSelectionPreviewExpandedPathsChange,
    onSettingsError,
    onSetFieldValue,
    onSetFieldNull,
    queryPath,
    resultView,
    resultsScopeKey,
    resultsStale = false,
    rows,
    selectedDocument = null,
    selectedDocumentPath = null,
    settings,
  }: FirestoreDocumentBrowserProps,
) {
  const resolvedInspectorUi = inspectorUi ?? defaultInspectorUi;
  const overviewCollapsed = resolvedInspectorUi.overviewCollapsed;
  const [uncontrolledInspectorWidth, setUncontrolledInspectorWidth] = useState(
    DEFAULT_INSPECTOR_WIDTH,
  );
  const inspectorWidth = clampInspectorWidth(
    controlledInspectorWidth ?? uncontrolledInspectorWidth,
  );
  const [uncontrolledOverviewCollapsed, setUncontrolledOverviewCollapsed] = useState(false);
  const effectiveOverviewCollapsed = inspectorUi
    ? overviewCollapsed
    : uncontrolledOverviewCollapsed;
  const [inspectorLayoutRevision, setInspectorLayoutRevision] = useState(0);
  const inspectorPanelElementRef = useRef<HTMLDivElement | null>(null);
  const inspectorInteractionVersion = useRef(0);
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
    if (controlledInspectorWidth !== undefined) return;
    if (!settings) {
      setInspectorLayoutRevision((revision) => revision + 1);
      return;
    }
    let cancelled = false;
    const loadInteractionVersion = inspectorInteractionVersion.current;
    settings.load().then((snapshot) => {
      if (cancelled || inspectorInteractionVersion.current !== loadInteractionVersion) return;
      setUncontrolledInspectorWidth(clampInspectorWidth(snapshot.inspectorWidth));
      setInspectorLayoutRevision((revision) => revision + 1);
    }).catch((caught) => {
      if (!cancelled) {
        onSettingsError?.(messageFromError(caught, 'Could not load inspector layout settings.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [controlledInspectorWidth, onInspectorWidthChange, onSettingsError, settings]);

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
    inspectorInteractionVersion.current += 1;
    if (controlledInspectorWidth === undefined) setUncontrolledInspectorWidth(nextWidth);
    onInspectorWidthChange?.(nextWidth);
  }

  function setOverviewCollapsed(collapsed: boolean) {
    if (inspectorUi) onInspectorOverviewCollapsedChange?.(collapsed);
    else setUncontrolledOverviewCollapsed(collapsed);
    setInspectorLayoutRevision((revision) => revision + 1);
  }

  function saveInspectorWidthFromLayout() {
    if (effectiveOverviewCollapsed) return;
    const width = inspectorPanelElementRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= COLLAPSED_INSPECTOR_WIDTH + 1) return;
    saveInspectorWidth(width);
  }

  function setInspectorSectionOpen(section: FirestoreInspectorSectionId, open: boolean) {
    onInspectorSectionOpenChange?.(section, open);
  }

  function setSelectionPreviewExpandedPaths(expandedPaths: ReadonlySet<string>) {
    if (!selectedDocumentWithSubcollections) return;
    onSelectionPreviewExpandedPathsChange?.(
      selectedDocumentWithSubcollections.path,
      Array.from(expandedPaths),
    );
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
        resultTreeExpandedIds={inspectorUi ? resolvedInspectorUi.resultTreeExpandedIds : undefined}
        resultView={resultView}
        resultsScopeKey={resultsScopeKey ?? queryPath}
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
        onResultTreeExpandedIdsChange={onResultTreeExpandedIdsChange}
        onSettingsError={onSettingsError}
        onSetFieldNull={onSetFieldNull}
      />
    </div>
  );

  const savedSelectionPreviewExpandedPaths = selectedDocumentWithSubcollections
    ? resolvedInspectorUi.selectionPreviewExpandedPathsByDocumentPath[
      selectedDocumentWithSubcollections.path
    ]
    : undefined;
  const selectedPreviewExpandedPaths = savedSelectionPreviewExpandedPaths === undefined
    ? undefined
    : new Set(savedSelectionPreviewExpandedPaths);
  const controlledSections = inspectorUi ? resolvedInspectorUi.sections : undefined;
  const controlledSelectedPreviewExpandedPaths = inspectorUi
    ? selectedPreviewExpandedPaths
    : undefined;
  const expandedOverviewPanel = (
    <ResultContextPanel
      resultView={resultView}
      rows={rowsWithSubcollections}
      sections={controlledSections}
      selectedDocument={selectedDocumentWithSubcollections}
      selectionPreviewExpandedPaths={controlledSelectedPreviewExpandedPaths}
      onCollapse={() => setOverviewCollapsed(true)}
      onDeleteDocument={onDeleteDocument}
      onDeleteField={onDeleteField}
      onEditDocument={onEditDocument}
      onEditField={onEditField}
      onOpenDocumentInNewTab={onOpenDocumentInNewTab}
      onSectionOpenChange={setInspectorSectionOpen}
      onSelectionPreviewExpandedPathsChange={setSelectionPreviewExpandedPaths}
      onSetFieldValue={onSetFieldValue}
      onSetFieldNull={onSetFieldNull}
    />
  );
  const collapsedOverviewPanel = (
    <OverviewCollapseStrip onExpand={() => setOverviewCollapsed(false)} />
  );

  return (
    <div className={cn('h-full min-h-0', className)}>
      {useSplitLayout
        ? (
          <ResizablePanelGroup
            key={`${
              effectiveOverviewCollapsed ? 'overview-collapsed' : 'overview-expanded'
            }:${inspectorLayoutRevision}`}
            direction='horizontal'
            className='h-full min-h-0'
            onLayoutChanged={saveInspectorWidthFromLayout}
          >
            <ResizablePanel
              className='flex h-full min-h-0 flex-col'
              minSize={`${MIN_RESULTS_WIDTH}px`}
            >
              {mainColumn}
            </ResizablePanel>
            <ResizableHandle className='mx-2 h-full w-px' />
            {effectiveOverviewCollapsed
              ? (
                <ResizablePanel
                  className='flex h-full min-h-0 flex-col'
                  defaultSize={`${COLLAPSED_INSPECTOR_WIDTH}px`}
                  groupResizeBehavior='preserve-pixel-size'
                  maxSize={`${COLLAPSED_INSPECTOR_WIDTH}px`}
                  minSize={`${COLLAPSED_INSPECTOR_WIDTH}px`}
                >
                  {collapsedOverviewPanel}
                </ResizablePanel>
              )
              : (
                <ResizablePanel
                  className='flex h-full min-h-0 flex-col'
                  collapsedSize={`${COLLAPSED_INSPECTOR_WIDTH}px`}
                  collapsible
                  defaultSize={`${inspectorWidth}px`}
                  elementRef={inspectorPanelElementRef}
                  groupResizeBehavior='preserve-pixel-size'
                  minSize={`${MIN_INSPECTOR_WIDTH}px`}
                  onResize={(size) => {
                    if (size.inPixels <= COLLAPSED_INSPECTOR_WIDTH + 1) {
                      setOverviewCollapsed(true);
                    }
                  }}
                >
                  {expandedOverviewPanel}
                </ResizablePanel>
              )}
          </ResizablePanelGroup>
        )
        : (
          <div className='grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(220px,34%)] gap-2'>
            {mainColumn}
            {effectiveOverviewCollapsed ? collapsedOverviewPanel : expandedOverviewPanel}
          </div>
        )}
    </div>
  );
}

function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_INSPECTOR_WIDTH;
  return Math.max(MIN_INSPECTOR_WIDTH, Math.round(width));
}
