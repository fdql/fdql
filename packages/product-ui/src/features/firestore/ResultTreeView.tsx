import type { DensityName } from '@firebase-desk/design-tokens';
import type { FirestoreDocumentResult } from '@firebase-desk/repo-contracts';
import { Button, ExplorerTree, IconButton } from '@firebase-desk/ui';
import { Folder, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { DocumentContextMenuContent, FieldContextMenuContent } from './FieldContextMenu.tsx';
import { type FieldEditTarget } from './fieldEditModel.ts';
import {
  documentsForCollectionNode,
  flattenResultTree,
  type ResultTreeRowModel,
  subcollectionLoadLabel,
  type SubcollectionLoadState,
} from './resultModel.tsx';

const EMPTY_VALUE_CHILD_LIMITS = new Map<string, number>();

export function ResultTreeView(
  {
    density,
    expandedIds,
    hasMore,
    isFetchingMore,
    onLoadMore,
    onLoadSubcollections,
    onOpenDocumentInNewTab,
    onDeleteDocument,
    onDeleteField,
    onEditField,
    onSelectDocument,
    onSetFieldNull,
    onShowMoreValueChildren,
    onToggleNode,
    queryPath,
    scrollRestorationKey,
    rows,
    subcollectionStates,
    valueChildLimits,
  }: {
    readonly density?: DensityName | undefined;
    readonly expandedIds: ReadonlySet<string>;
    readonly hasMore: boolean;
    readonly isFetchingMore: boolean;
    readonly onDeleteDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
    readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
    readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
    readonly onLoadMore: () => void;
    readonly onLoadSubcollections?: ((documentPath: string) => Promise<void> | void) | undefined;
    readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
    readonly onSelectDocument?: ((documentPath: string) => void) | undefined;
    readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
    readonly onShowMoreValueChildren?: ((id: string) => void) | undefined;
    readonly onToggleNode: (id: string) => void;
    readonly queryPath: string;
    readonly scrollRestorationKey?: string | undefined;
    readonly rows: ReadonlyArray<FirestoreDocumentResult>;
    readonly subcollectionStates: Readonly<Record<string, SubcollectionLoadState>>;
    readonly valueChildLimits?: ReadonlyMap<string, number> | undefined;
  },
) {
  const canLoadSubcollections = Boolean(onLoadSubcollections);
  const documentsByPath = useMemo(() => documentsByPathMap(rows), [rows]);
  const treeRows = useMemo(
    () =>
      flattenResultTree(
        queryPath,
        rows,
        hasMore,
        expandedIds,
        subcollectionStates,
        canLoadSubcollections,
        valueChildLimits ?? EMPTY_VALUE_CHILD_LIMITS,
      ),
    [
      canLoadSubcollections,
      expandedIds,
      hasMore,
      queryPath,
      rows,
      subcollectionStates,
      valueChildLimits,
    ],
  );
  const openNode = useCallback(
    (id: string) => {
      const node = treeRows.find((item) => item.id === id);
      if (node?.openPath) onOpenDocumentInNewTab?.(node.openPath);
    },
    [onOpenDocumentInNewTab, treeRows],
  );
  const selectNode = useCallback(
    (id: string) => {
      const node = treeRows.find((item) => item.id === id);
      if (node?.documentPath) onSelectDocument?.(node.documentPath);
    },
    [onSelectDocument, treeRows],
  );

  return (
    <ExplorerTree
      className='select-text'
      density={density}
      rows={treeRows}
      scrollRestorationKey={scrollRestorationKey}
      onOpen={openNode}
      onSelect={selectNode}
      onToggle={onToggleNode}
      contextMenu={(node) =>
        node.fieldPath && node.documentPath && node.fieldValue !== undefined
          ? (
            <FieldContextMenuContent
              document={documentsByPath.get(node.documentPath) ?? {
                id: node.documentPath.split('/').at(-1) ?? node.documentPath,
                path: node.documentPath,
                data: {},
                hasSubcollections: false,
              }}
              fieldPath={node.fieldPath}
              value={node.fieldValue}
              onDeleteDocument={onDeleteDocument}
              onDeleteField={onDeleteField}
              onEditField={onEditField}
              onOpenDocumentInNewTab={onOpenDocumentInNewTab}
              onSetFieldNull={onSetFieldNull}
            />
          )
          : node.documentPath && documentsByPath.has(node.documentPath)
              && (onOpenDocumentInNewTab || onDeleteDocument)
          ? (
            <DocumentContextMenuContent
              document={documentsByPath.get(node.documentPath)!}
              onDeleteDocument={onDeleteDocument}
              onOpenDocumentInNewTab={onOpenDocumentInNewTab}
            />
          )
          : null}
      renderAction={(node) => (
        <TreeRowAction
          isFetchingMore={isFetchingMore}
          node={node}
          onLoadMore={onLoadMore}
          onLoadSubcollections={onLoadSubcollections}
          onShowMoreValueChildren={onShowMoreValueChildren}
          onOpenDocumentInNewTab={onOpenDocumentInNewTab}
          onDeleteDocument={onDeleteDocument}
          documentsByPath={documentsByPath}
        />
      )}
    />
  );
}

function TreeRowAction(
  {
    isFetchingMore,
    node,
    onLoadMore,
    onLoadSubcollections,
    onShowMoreValueChildren,
    onOpenDocumentInNewTab,
    onDeleteDocument,
    documentsByPath,
  }: {
    readonly isFetchingMore: boolean;
    readonly node: ResultTreeRowModel;
    readonly onLoadMore: () => void;
    readonly onLoadSubcollections?: ((documentPath: string) => Promise<void> | void) | undefined;
    readonly onShowMoreValueChildren?: ((id: string) => void) | undefined;
    readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
    readonly onDeleteDocument?: ((document: FirestoreDocumentResult) => void) | undefined;
    readonly documentsByPath: ReadonlyMap<string, FirestoreDocumentResult>;
  },
) {
  if (node.kind === 'load-more') {
    return (
      <Button
        disabled={isFetchingMore}
        size='xs'
        variant='secondary'
        onClick={(event) => {
          event.stopPropagation();
          onLoadMore();
        }}
      >
        Load more
      </Button>
    );
  }
  if (node.kind === 'load-value-children' && node.valueChildLimitTargetId) {
    return (
      <Button
        size='xs'
        variant='secondary'
        onClick={(event) => {
          event.stopPropagation();
          onShowMoreValueChildren?.(node.valueChildLimitTargetId ?? '');
        }}
      >
        Show more
      </Button>
    );
  }
  if (node.kind === 'load-subcollections' && node.documentPath && onLoadSubcollections) {
    return (
      <Button
        disabled={node.subcollectionStatus === 'loading'}
        size='xs'
        variant={node.subcollectionStatus === 'error' ? 'secondary' : 'ghost'}
        onClick={(event) => {
          event.stopPropagation();
          onLoadSubcollections(node.documentPath ?? '');
        }}
      >
        {node.subcollectionStatus === 'loading'
          ? <Loader2 className='animate-spin' size={13} aria-hidden='true' />
          : <Folder size={13} aria-hidden='true' />}
        {subcollectionLoadLabel(node.subcollectionStatus)}
      </Button>
    );
  }
  if (isDocumentRow(node) && node.documentPath && documentsByPath.has(node.documentPath)) {
    return (
      <span className='flex items-center gap-1'>
        {onOpenDocumentInNewTab
          ? (
            <IconButton
              icon={<Folder size={13} aria-hidden='true' />}
              label={`Open ${node.label}`}
              size='xs'
              variant='ghost'
              onClick={(event) => {
                event.stopPropagation();
                onOpenDocumentInNewTab(node.documentPath ?? '');
              }}
            />
          )
          : null}
        {onDeleteDocument
          ? (
            <IconButton
              icon={<Trash2 size={13} aria-hidden='true' />}
              label={`Delete ${node.label}`}
              size='xs'
              variant='ghost'
              onClick={(event) => {
                event.stopPropagation();
                const document = documentsByPath.get(node.documentPath ?? '');
                if (document) onDeleteDocument(document);
              }}
            />
          )
          : null}
      </span>
    );
  }
  if (node.openPath && onOpenDocumentInNewTab) {
    return (
      <IconButton
        icon={<Folder size={13} aria-hidden='true' />}
        label={`Open ${node.label}`}
        size='xs'
        variant='ghost'
        onClick={(event) => {
          event.stopPropagation();
          onOpenDocumentInNewTab(node.openPath ?? '');
        }}
      />
    );
  }
  return null;
}

function isDocumentRow(node: ResultTreeRowModel): boolean {
  return Boolean(node.documentPath && node.id === `doc:${node.documentPath}`);
}

function documentsByPathMap(
  rows: ReadonlyArray<FirestoreDocumentResult>,
): ReadonlyMap<string, FirestoreDocumentResult> {
  const map = new Map<string, FirestoreDocumentResult>();
  for (const row of rows) appendDocument(row, map);
  return map;
}

function appendDocument(
  document: FirestoreDocumentResult,
  map: Map<string, FirestoreDocumentResult>,
) {
  map.set(document.path, document);
  for (const collection of document.subcollections ?? []) {
    for (const child of documentsForCollectionNode(collection)) appendDocument(child, map);
  }
}
