import type { FirestoreDocumentResult } from '@firebase-desk/repo-contracts';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { FieldContextMenu } from './FieldContextMenu.tsx';
import { type FieldEditTarget, fieldPathFromTreeKey } from './fieldEditModel.ts';
import {
  firestoreValueType,
  formatFirestoreValue,
  isFirestoreTypedValue,
} from './FirestoreValueCell.tsx';

const NESTED_VALUE_CHILD_BATCH_SIZE = 100;

export interface NestedValueTreeProps {
  readonly document?: FirestoreDocumentResult | undefined;
  readonly expandedPaths?: ReadonlySet<string> | undefined;
  readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
  readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
  readonly onExpandedPathsChange?: ((expandedPaths: ReadonlySet<string>) => void) | undefined;
  readonly onSetFieldValue?: ((target: FieldEditTarget, value: unknown) => void) | undefined;
  readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
  readonly value: Record<string, unknown>;
}

export function NestedValueTree(
  {
    document,
    expandedPaths,
    onDeleteField,
    onEditField,
    onExpandedPathsChange,
    onSetFieldNull,
    onSetFieldValue,
    value,
  }: NestedValueTreeProps,
) {
  const actionProps = { document, onDeleteField, onEditField, onSetFieldNull, onSetFieldValue };
  const defaultExpandedPaths = useMemo(() => topLevelExpandedPaths(value), [value]);
  const [uncontrolledExpandedPaths, setUncontrolledExpandedPaths] = useState(defaultExpandedPaths);
  const resolvedExpandedPaths = expandedPaths ?? uncontrolledExpandedPaths;
  useEffect(() => {
    if (expandedPaths === undefined) setUncontrolledExpandedPaths(defaultExpandedPaths);
  }, [defaultExpandedPaths, expandedPaths]);
  function setExpanded(pathKey: string, expanded: boolean) {
    const next = new Set(resolvedExpandedPaths);
    if (expanded) next.add(pathKey);
    else next.delete(pathKey);
    if (expandedPaths === undefined) setUncontrolledExpandedPaths(next);
    onExpandedPathsChange?.(next);
  }
  return (
    <div className='max-h-[48vh] select-text overflow-auto rounded-md border border-border-subtle font-mono text-xs'>
      {Object.entries(value).map(([key, entry]) => (
        <NestedValueNode
          key={key}
          actionProps={actionProps}
          expandedPaths={resolvedExpandedPaths}
          level={0}
          nodeKey={key}
          onExpandedChange={setExpanded}
          parentPath={[]}
          value={entry}
        />
      ))}
    </div>
  );
}

interface TreeActionProps {
  readonly document?: FirestoreDocumentResult | undefined;
  readonly onDeleteField?: ((target: FieldEditTarget) => void) | undefined;
  readonly onEditField?: ((target: FieldEditTarget, jsonMode: boolean) => void) | undefined;
  readonly onSetFieldValue?: ((target: FieldEditTarget, value: unknown) => void) | undefined;
  readonly onSetFieldNull?: ((target: FieldEditTarget) => void) | undefined;
}

function NestedValueNode(
  {
    actionProps,
    expandedPaths,
    level,
    nodeKey,
    onExpandedChange,
    parentPath,
    value,
  }: {
    readonly actionProps: TreeActionProps;
    readonly expandedPaths: ReadonlySet<string>;
    readonly level: number;
    readonly nodeKey: string;
    readonly onExpandedChange: (pathKey: string, expanded: boolean) => void;
    readonly parentPath: ReadonlyArray<string>;
    readonly value: unknown;
  },
): ReactNode {
  const fieldPath = fieldPathFromTreeKey(nodeKey, parentPath);
  if (isExpandableValue(value)) {
    return (
      <ExpandableNestedValueNode
        actionProps={actionProps}
        expandedPaths={expandedPaths}
        fieldPath={fieldPath}
        label={nodeKey}
        level={level}
        onExpandedChange={onExpandedChange}
        parentPath={parentPath}
        value={value}
      />
    );
  }
  const leaf = (
    <TreeLeaf
      action={fieldPath ? quickFieldAction(value, fieldPath, actionProps) : undefined}
      label={nodeKey}
      level={level}
      meta={valueType(value)}
      value={formatValue(value)}
    />
  );
  return withFieldContext(nodeKey, leaf, value, fieldPath, actionProps);
}

function ExpandableNestedValueNode(
  {
    actionProps,
    expandedPaths,
    fieldPath,
    label,
    level,
    onExpandedChange,
    parentPath,
    value,
  }: {
    readonly actionProps: TreeActionProps;
    readonly expandedPaths: ReadonlySet<string>;
    readonly fieldPath: ReadonlyArray<string> | null;
    readonly label: string;
    readonly level: number;
    readonly onExpandedChange: (pathKey: string, expanded: boolean) => void;
    readonly parentPath: ReadonlyArray<string>;
    readonly value: unknown;
  },
): ReactNode {
  const pathKey = nestedPathKey(fieldPath ?? [...parentPath, label]);
  const expanded = expandedPaths.has(pathKey);
  const [visibleCount, setVisibleCount] = useState(NESTED_VALUE_CHILD_BATCH_SIZE);
  const branch = (
    <TreeBranch
      expanded={expanded}
      icon={<Folder size={14} aria-hidden='true' />}
      label={label}
      level={level}
      meta={valueType(value)}
      onToggle={(nextExpanded) => onExpandedChange(pathKey, nextExpanded)}
    >
      {expanded
        ? renderExpandedBranchChildren(
          value,
          visibleCount,
          level,
          fieldPath ?? parentPath,
          actionProps,
          expandedPaths,
          onExpandedChange,
          setVisibleCount,
        )
        : null}
    </TreeBranch>
  );
  return withFieldContext(label, branch, value, fieldPath, actionProps);
}

function quickFieldAction(
  value: unknown,
  fieldPath: ReadonlyArray<string>,
  { document, onSetFieldValue }: TreeActionProps,
): ReactNode {
  if (!document || !onSetFieldValue || typeof value !== 'boolean') return null;
  const target: FieldEditTarget = { documentPath: document.path, fieldPath, value };
  return (
    <input
      aria-label={`Toggle ${fieldPath.join('.')}`}
      checked={value}
      type='checkbox'
      onChange={(event) => onSetFieldValue(target, event.currentTarget.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function withFieldContext(
  key: string,
  node: ReactNode,
  value: unknown,
  fieldPath: ReadonlyArray<string> | null,
  { document, onDeleteField, onEditField, onSetFieldNull }: TreeActionProps,
): ReactNode {
  if (!document || !fieldPath) return node;
  return (
    <FieldContextMenu
      key={key}
      document={document}
      fieldPath={fieldPath}
      value={value}
      onDeleteField={onDeleteField}
      onEditField={onEditField}
      onSetFieldNull={onSetFieldNull}
    >
      {node}
    </FieldContextMenu>
  );
}

interface TreeBranchProps {
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly expanded: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly level: number;
  readonly meta: string;
  readonly onToggle: (expanded: boolean) => void;
}

function TreeBranch(
  { action, children, expanded, icon, label, level, meta, onToggle }: TreeBranchProps,
) {
  return (
    <div className='block' role='treeitem'>
      <button
        aria-expanded={expanded}
        className='grid min-h-8 cursor-pointer list-none grid-cols-[16px_16px_minmax(140px,0.8fr)_minmax(160px,1fr)_112px_auto] items-center gap-2 border-b border-border-subtle pr-3 text-text-primary transition-colors hover:bg-action-ghost-hover [&::-webkit-details-marker]:hidden'
        type='button'
        style={{ paddingLeft: 12 + level * 22 }}
        onClick={() => onToggle(!expanded)}
      >
        <ChevronRight
          size={13}
          aria-hidden='true'
          className={`text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className='text-action-primary'>{icon}</span>
        <span className='min-w-0 truncate font-medium'>{label}</span>
        <span />
        <code className='text-text-muted'>{meta}</code>
        <span>{action}</span>
      </button>
      {expanded ? <div role='group'>{children}</div> : null}
    </div>
  );
}

function TreeMoreRow(
  { countLabel, level, onClick }: {
    readonly countLabel: string;
    readonly level: number;
    readonly onClick: () => void;
  },
) {
  return (
    <div
      className='grid min-h-8 grid-cols-[16px_16px_minmax(140px,0.8fr)_minmax(160px,1fr)_112px_auto] items-center gap-2 border-b border-border-subtle pr-3 text-text-primary'
      role='treeitem'
      style={{ paddingLeft: 12 + level * 22 }}
    >
      <span />
      <FileText size={13} aria-hidden='true' className='text-text-muted' />
      <span className='min-w-0 truncate font-medium'>{countLabel}</span>
      <span className='min-w-0 truncate text-text-muted'>Showing first items</span>
      <code className='text-text-muted'>more</code>
      <button
        className='justify-self-start rounded border border-border-subtle px-2 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-action-ghost-hover'
        type='button'
        onClick={onClick}
      >
        Show more
      </button>
    </div>
  );
}

function renderExpandedBranchChildren(
  value: unknown,
  visibleCount: number,
  level: number,
  parentPath: ReadonlyArray<string>,
  actionProps: TreeActionProps,
  expandedPaths: ReadonlySet<string>,
  onExpandedChange: (pathKey: string, expanded: boolean) => void,
  setVisibleCount: (update: (current: number) => number) => void,
): ReactNode {
  const { entries, hasMore, remaining } = expandableEntryWindow(value, visibleCount);
  return (
    <>
      {entries.map(([childKey, childValue]) => (
        <NestedValueNode
          key={childKey}
          actionProps={actionProps}
          expandedPaths={expandedPaths}
          level={level + 1}
          nodeKey={childKey}
          onExpandedChange={onExpandedChange}
          parentPath={parentPath}
          value={childValue}
        />
      ))}
      {hasMore
        ? (
          <TreeMoreRow
            countLabel={remaining === null ? 'More entries' : `${remaining} more items`}
            level={level + 1}
            onClick={() => setVisibleCount((current) => current + NESTED_VALUE_CHILD_BATCH_SIZE)}
          />
        )
        : null}
    </>
  );
}

interface TreeLeafProps {
  readonly action?: ReactNode;
  readonly label: string;
  readonly level: number;
  readonly meta: string;
  readonly value: string;
}

function TreeLeaf({ action, label, level, meta, value }: TreeLeafProps) {
  return (
    <div
      className='grid min-h-8 grid-cols-[16px_16px_minmax(140px,0.8fr)_minmax(160px,1fr)_112px_auto] items-center gap-2 border-b border-border-subtle pr-3 text-text-primary transition-colors hover:bg-action-ghost-hover'
      role='treeitem'
      style={{ paddingLeft: 12 + level * 22 }}
    >
      <span />
      <FileText size={13} aria-hidden='true' className='text-text-muted' />
      <span className='min-w-0 truncate font-medium'>{label}</span>
      <span className='min-w-0 truncate text-text-muted'>{value}</span>
      <code className='text-text-muted'>{meta}</code>
      <span>{action}</span>
    </div>
  );
}

function isExpandableValue(value: unknown): boolean {
  if (encodedExpandableValue(value)) return true;
  return value !== null && typeof value === 'object' && !isFirestoreTypedValue(value);
}

function encodedExpandableValue(value: unknown): unknown[] | Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = (value as { readonly __type__?: unknown; }).__type__;
  const entries = (value as { readonly value?: unknown; }).value;
  if (
    type === 'map' && entries !== null && typeof entries === 'object' && !Array.isArray(entries)
  ) {
    return entries as Record<string, unknown>;
  }
  if (type === 'array' && Array.isArray(entries)) return entries;
  return null;
}

function expandableEntryWindow(
  value: unknown,
  limit: number,
): {
  readonly entries: ReadonlyArray<readonly [string, unknown]>;
  readonly hasMore: boolean;
  readonly remaining: number | null;
} {
  const encoded = encodedExpandableValue(value);
  if (encoded) return expandableEntryWindow(encoded, limit);
  if (Array.isArray(value)) {
    return {
      entries: value.slice(0, limit).map((entry, index) => [`[${index}]`, entry] as const),
      hasMore: value.length > limit,
      remaining: value.length > limit ? value.length - limit : 0,
    };
  }
  const entries: Array<readonly [string, unknown]> = [];
  let hasMore = false;
  for (const key in value as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (entries.length >= limit) {
      hasMore = true;
      break;
    }
    entries.push([key, (value as Record<string, unknown>)[key]] as const);
  }
  return { entries, hasMore, remaining: null };
}

function topLevelExpandedPaths(value: Record<string, unknown>): ReadonlySet<string> {
  return new Set(
    Object.entries(value)
      .filter(([, entry]) => isExpandableValue(entry))
      .map(([key]) => nestedPathKey([key])),
  );
}

function nestedPathKey(path: ReadonlyArray<string>): string {
  return JSON.stringify(path);
}

function valueType(value: unknown): string {
  return firestoreValueType(value);
}

function formatValue(value: unknown): string {
  return formatFirestoreValue(value);
}
