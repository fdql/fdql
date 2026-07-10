import type { FirestoreFieldCatalogEntry, FirestoreFieldType } from '@firebase-desk/repo-contracts';
import { cn } from '@firebase-desk/ui';
import { Command } from 'cmdk';
import {
  Binary,
  Braces,
  CalendarClock,
  Hash,
  Link,
  List,
  MapPin,
  ToggleLeft,
  Type,
} from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { type FirestoreTypeIcon, iconForFirestoreFieldType } from './firestoreTypeRegistry.ts';

const MAX_SUGGESTIONS = 24;
const FIELD_COMMIT_DELAY_MS = 120;

type FieldSuggestionItem =
  | {
    readonly kind: 'custom';
    readonly value: string;
  }
  | {
    readonly kind: 'suggestion';
    readonly suggestion: FirestoreFieldCatalogEntry;
  };

interface IndexedFieldSuggestion {
  readonly depth: number;
  readonly fieldLower: string;
  readonly suggestion: FirestoreFieldCatalogEntry;
}

type RankedFieldSuggestion = IndexedFieldSuggestion;

export interface FieldAutocompleteInputProps {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: string) => void;
  readonly placeholder?: string;
  readonly suggestions?: ReadonlyArray<FirestoreFieldCatalogEntry>;
  readonly value: string;
}

const inputClassName =
  'h-[var(--density-control-height)] w-full rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-action-primary focus:ring-2 focus:ring-action-primary/20 disabled:cursor-not-allowed disabled:opacity-60';

export function FieldAutocompleteInput(
  {
    ariaLabel,
    className,
    disabled = false,
    onCommit,
    placeholder,
    suggestions = [],
    value,
  }: FieldAutocompleteInputProps,
) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedValueRef = useRef(value);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const indexedSuggestions = useMemo(
    () =>
      suggestions.map((suggestion) => ({
        depth: fieldDepth(suggestion.field),
        fieldLower: suggestion.field.toLowerCase(),
        suggestion,
      })),
    [suggestions],
  );
  const suggestionItems = useMemo(
    () => fieldSuggestionItems(indexedSuggestions, draftValue),
    [indexedSuggestions, draftValue],
  );
  const showSuggestions = open && !disabled && suggestionItems.length > 0;

  useEffect(() => {
    if (value === committedValueRef.current) return;
    clearPendingCommit();
    committedValueRef.current = value;
    setDraftValue(value);
  }, [value]);

  useEffect(() => () => clearPendingCommit(), []);

  useLayoutEffect(() => {
    if (!showSuggestions) {
      setDropdownStyle(null);
      return;
    }

    function updatePosition() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownStyle({
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
      });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showSuggestions]);

  function clearPendingCommit() {
    if (commitTimerRef.current === null) return;
    clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  }

  function commitValue(nextValue: string) {
    clearPendingCommit();
    if (committedValueRef.current === nextValue) return;
    committedValueRef.current = nextValue;
    onCommit(nextValue);
  }

  function scheduleCommit(nextValue: string) {
    clearPendingCommit();
    commitTimerRef.current = setTimeout(() => {
      commitValue(nextValue);
    }, FIELD_COMMIT_DELAY_MS);
  }

  return (
    <Command ref={rootRef} className='min-w-0' shouldFilter={false}>
      <Command.Input
        aria-label={ariaLabel}
        className={cn(inputClassName, className)}
        disabled={disabled}
        placeholder={placeholder}
        value={draftValue}
        onBlur={() => {
          commitValue(draftValue);
          setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter') commitValue(draftValue);
        }}
        onValueChange={(nextValue) => {
          setDraftValue(nextValue);
          scheduleCommit(nextValue);
          setOpen(true);
        }}
      />
      {showSuggestions && dropdownStyle && typeof document !== 'undefined'
        ? createPortal(
          <Command.List
            className='fixed z-[1000] max-h-56 overflow-auto rounded-md border border-border-subtle bg-bg-elevated p-1 shadow-lg'
            style={dropdownStyle}
            onMouseDown={(event) => event.preventDefault()}
          >
            {suggestionItems.map((item) =>
              item.kind === 'custom'
                ? (
                  <Command.Item
                    key={`custom:${item.value}`}
                    className='flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-action-selected'
                    value={item.value}
                    onSelect={() => {
                      setDraftValue(item.value);
                      commitValue(item.value);
                      setOpen(false);
                    }}
                  >
                    <span className='min-w-0 flex-1 truncate'>
                      Use <code>{item.value}</code>
                    </span>
                    <span className='shrink-0 text-xs text-text-muted'>custom</span>
                  </Command.Item>
                )
                : (
                  <Command.Item
                    key={item.suggestion.field}
                    className='flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-action-selected'
                    value={item.suggestion.field}
                    onSelect={(field) => {
                      setDraftValue(field);
                      commitValue(field);
                      setOpen(false);
                    }}
                  >
                    <span className='grid size-4 shrink-0 place-items-center text-text-muted'>
                      {iconForTypes(item.suggestion.types)}
                    </span>
                    <span className='min-w-0 flex-1 truncate font-mono'>
                      {item.suggestion.field}
                    </span>
                    <span className='shrink-0 truncate text-xs text-text-muted'>
                      {item.suggestion.types.join(', ')}
                    </span>
                  </Command.Item>
                )
            )}
          </Command.List>,
          document.body,
        )
        : null}
    </Command>
  );
}

function fieldSuggestionItems(
  suggestions: ReadonlyArray<IndexedFieldSuggestion>,
  value: string,
): ReadonlyArray<FieldSuggestionItem> {
  const query = value.trim().toLowerCase();
  const customValue = value.trim();
  let hasExactMatch = customValue.length === 0;
  const ranked: RankedFieldSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (customValue && suggestion.fieldLower === query) hasExactMatch = true;
    if (query && !suggestion.fieldLower.includes(query)) continue;
    insertRankedSuggestion(ranked, suggestion, query);
  }

  return [
    ...(customValue && !hasExactMatch ? [{ kind: 'custom' as const, value: customValue }] : []),
    ...ranked.map((entry) => ({ kind: 'suggestion' as const, suggestion: entry.suggestion })),
  ];
}

function insertRankedSuggestion(
  ranked: RankedFieldSuggestion[],
  candidate: RankedFieldSuggestion,
  query: string,
) {
  if (ranked.length === MAX_SUGGESTIONS) {
    const last = ranked.at(-1)!;
    if (compareSuggestions(candidate, last, query) >= 0) return;
  }
  const insertAt = ranked.findIndex((entry) => compareSuggestions(candidate, entry, query) < 0);
  if (insertAt === -1) ranked.push(candidate);
  else ranked.splice(insertAt, 0, candidate);
  if (ranked.length > MAX_SUGGESTIONS) ranked.pop();
}

function compareSuggestions(
  left: RankedFieldSuggestion,
  right: RankedFieldSuggestion,
  query: string,
): number {
  const leftExact = query.length > 0 && left.fieldLower === query;
  const rightExact = query.length > 0 && right.fieldLower === query;
  if (leftExact !== rightExact) return leftExact ? -1 : 1;
  const leftStarts = query.length > 0 && left.fieldLower.startsWith(query);
  const rightStarts = query.length > 0 && right.fieldLower.startsWith(query);
  if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
  if (left.depth !== right.depth) return left.depth - right.depth;
  if (left.suggestion.count !== right.suggestion.count) {
    return right.suggestion.count - left.suggestion.count;
  }
  return left.suggestion.field.localeCompare(right.suggestion.field);
}

function fieldDepth(field: string): number {
  return field.split('.').length;
}

function iconForTypes(types: ReadonlyArray<FirestoreFieldType>): ReactNode {
  return iconForType(iconForFirestoreFieldType(types[0] ?? 'string'));
}

function iconForType(type: FirestoreTypeIcon): ReactNode {
  if (type === 'array') return <List size={14} aria-hidden='true' />;
  if (type === 'number') return <Hash size={14} aria-hidden='true' />;
  if (type === 'boolean') return <ToggleLeft size={14} aria-hidden='true' />;
  if (type === 'timestamp') return <CalendarClock size={14} aria-hidden='true' />;
  if (type === 'geoPoint') return <MapPin size={14} aria-hidden='true' />;
  if (type === 'reference') return <Link size={14} aria-hidden='true' />;
  if (type === 'bytes') return <Binary size={14} aria-hidden='true' />;
  if (type === 'null' || type === 'map') return <Braces size={14} aria-hidden='true' />;
  return <Type size={14} aria-hidden='true' />;
}
