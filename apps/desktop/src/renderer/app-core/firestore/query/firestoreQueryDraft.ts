import type {
  FirestoreQueryDraft,
  FirestoreQueryDraftEdit,
  FirestoreQueryFilterDraft,
} from '@firebase-desk/repo-contracts';

export const DEFAULT_FIRESTORE_DRAFT: FirestoreQueryDraft = {
  path: 'orders',
  filters: [],
  filterField: '',
  filterOp: '==',
  filterValue: '',
  sortField: '',
  sortDirection: 'desc',
  limit: 25,
};

export function createFirestoreDraft(path = DEFAULT_FIRESTORE_DRAFT.path): FirestoreQueryDraft {
  return { ...DEFAULT_FIRESTORE_DRAFT, filters: [], path };
}

export function normalizeFirestorePath(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}

export function firestoreCollectionPathForTarget(path: string): string {
  const parts = normalizeFirestorePath(path).split('/').filter(Boolean);
  if (parts.length > 0 && parts.length % 2 === 0) parts.pop();
  return parts.join('/');
}

export function firestoreDraftWithPath(
  draft: FirestoreQueryDraft,
  path: string,
): FirestoreQueryDraft {
  return { ...draft, path };
}

export function applyFirestoreDraftEdit(
  draft: FirestoreQueryDraft,
  edit: FirestoreQueryDraftEdit,
): FirestoreQueryDraft {
  if (edit.type === 'path-set') return { ...draft, path: edit.path };
  if (edit.type === 'limit-set') return { ...draft, limit: edit.limit };
  if (edit.type === 'sort-field-set') return { ...draft, sortField: edit.sortField };
  if (edit.type === 'sort-direction-set') {
    return { ...draft, sortDirection: edit.sortDirection };
  }
  if (edit.type === 'reset') return createFirestoreDraft(draft.path);

  const filters = normalizedDraftFilters(draft);
  if (edit.type === 'filter-add') return withFilters(draft, [...filters, edit.filter]);
  if (edit.type === 'filter-remove') {
    return withFilters(draft, filters.filter((filter) => filter.id !== edit.filterId));
  }
  return withFilters(
    draft,
    filters.map((filter) =>
      filter.id === edit.filterId ? Object.assign({}, filter, edit.patch) : filter
    ),
  );
}

export function firestoreDraftFingerprint(
  connectionId: string,
  draft: FirestoreQueryDraft,
): string {
  const path = normalizeFirestorePath(draft.path);
  const isCollectionQuery = path.split('/').filter(Boolean).length % 2 === 1;
  const sortField = isCollectionQuery ? draft.sortField.trim() : '';
  return JSON.stringify({
    connectionId,
    filters: isCollectionQuery
      ? normalizedDraftFilters(draft)
        .filter((filter) => filter.field.trim())
        .map((filter) => ({
          field: filter.field.trim(),
          op: filter.op,
          value: fingerprintFilterValue(filter.value),
        }))
      : [],
    limit: isCollectionQuery ? draft.limit : null,
    path,
    sort: sortField ? { direction: draft.sortDirection, field: sortField } : null,
  });
}

function fingerprintFilterValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function normalizedDraftFilters(
  draft: FirestoreQueryDraft,
): ReadonlyArray<FirestoreQueryFilterDraft> {
  if (draft.filters) return draft.filters;
  if (!draft.filterField && !draft.filterValue) return [];
  return [{
    id: 'filter-1',
    field: draft.filterField,
    op: draft.filterOp,
    value: draft.filterValue,
  }];
}

function withFilters(
  draft: FirestoreQueryDraft,
  filters: ReadonlyArray<FirestoreQueryFilterDraft>,
): FirestoreQueryDraft {
  const first = filters[0];
  return {
    ...draft,
    filters,
    filterField: first?.field ?? '',
    filterOp: first?.op ?? '==',
    filterValue: first?.value ?? '',
  };
}
