import type {
  FirestoreDocumentResult,
  FirestoreFieldCatalogEntry,
  FirestoreFieldCatalogs,
  FirestoreFieldType,
  FirestorePrimitiveFieldType,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import { useEffect, useMemo, useState } from 'react';
import { messageFromError } from '../../shared/errors.ts';
import { isPlainObject, primitiveCatalogTypeForValue } from './firestoreTypeRegistry.ts';
import { collectionLayoutKeyForPath } from './resultTableLayout.ts';

const FIELD_CATALOG_FIELD_LIMIT = 1_000;
const FIELD_CATALOG_VISIT_LIMIT = 2_000;
const FIELD_CATALOG_SCHEMA_DEPTH_LIMIT = 3;
const DYNAMIC_MAP_DEPTH_LIMIT = 2;
const DYNAMIC_MAP_MIN_KEYS = 3;
const DYNAMIC_MAP_SAMPLE_LIMIT = 25;
const DYNAMIC_MAP_REPEATED_FIELD_RATIO = 0.6;
const DYNAMIC_MAP_MIN_REPEATED_FIELDS = 2;

interface CatalogBudget {
  visits: number;
}

interface FieldAccumulator {
  count: number;
  types: Set<FirestoreFieldType>;
}

interface QueueItem {
  readonly dynamicDepth: number;
  readonly prefix: string;
  readonly records: ReadonlyArray<TraversalRecord>;
  readonly schemaDepth: number;
}

interface TraversalRecord {
  readonly rowIndex: number;
  readonly value: Record<string, unknown>;
}

interface ValueEntry {
  readonly rowIndex: number;
  readonly value: unknown;
}

interface DynamicMapInfo {
  readonly children: ReadonlyArray<TraversalRecord>;
  readonly placeholder: string;
}

export function fieldCatalogKeyForPath(path: string): string {
  return collectionLayoutKeyForPath(path);
}

export function fieldCatalogFromRows(
  rows: ReadonlyArray<FirestoreDocumentResult>,
): FirestoreFieldCatalogEntry[] {
  const fields = new Map<string, FieldAccumulator>();
  const budget = { visits: 0 };
  const rowFields = rows.map(() => new Set<string>());
  collectFields(
    rows.map((row, rowIndex) => ({ rowIndex, value: row.data })),
    fields,
    budget,
    rowFields,
  );
  return sortedEntries(fields);
}

export function mergeFieldCatalogEntries(
  existing: ReadonlyArray<FirestoreFieldCatalogEntry>,
  observed: ReadonlyArray<FirestoreFieldCatalogEntry>,
): FirestoreFieldCatalogEntry[] {
  const fields = new Map<string, { count: number; types: Set<FirestoreFieldType>; }>();
  const observedDynamicFields = observed
    .map((entry) => entry.field)
    .filter(hasPlaceholderSegment);
  for (const entry of existing) {
    if (observedDynamicFields.some((field) => fieldMatchesPlaceholder(entry.field, field))) {
      continue;
    }
    fields.set(entry.field, { count: entry.count, types: new Set(entry.types) });
  }
  for (const entry of observed) {
    const current = fields.get(entry.field) ?? { count: 0, types: new Set<FirestoreFieldType>() };
    for (const type of entry.types) current.types.add(type);
    fields.set(entry.field, { count: current.count + entry.count, types: current.types });
  }
  return sortedEntries(fields);
}

export function useFirestoreFieldCatalog(
  {
    onSettingsError,
    observationQueryPath,
    queryPath,
    rows,
    settings,
  }: {
    readonly onSettingsError?: ((message: string) => void) | undefined;
    readonly observationQueryPath?: string | null | undefined;
    readonly queryPath: string;
    readonly rows: ReadonlyArray<FirestoreDocumentResult>;
    readonly settings?: SettingsRepository | undefined;
  },
): ReadonlyArray<FirestoreFieldCatalogEntry> {
  const suggestionKey = useMemo(() => fieldCatalogKeyForPath(queryPath), [queryPath]);
  const observationKey = useMemo(
    () => fieldCatalogKeyForPath(observationQueryPath ?? queryPath),
    [observationQueryPath, queryPath],
  );
  const [catalogs, setCatalogs] = useState<FirestoreFieldCatalogs>({});

  useEffect(() => {
    if (!settings) {
      setCatalogs({});
      return;
    }
    let cancelled = false;
    settings.load().then((snapshot) => {
      if (!cancelled) setCatalogs(snapshot.firestoreFieldCatalogs);
    }).catch((error) => {
      if (!cancelled) {
        setCatalogs({});
        onSettingsError?.(messageFromError(error, 'Could not load field catalog settings.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onSettingsError, settings]);

  useEffect(() => {
    if (!settings || rows.length === 0) return;
    const observed = fieldCatalogFromRows(rows);
    if (!observed.length) return;
    let cancelled = false;
    settings.load()
      .then((snapshot) => {
        const currentEntries = snapshot.firestoreFieldCatalogs[observationKey] ?? [];
        const mergedEntries = mergeFieldCatalogEntries(currentEntries, observed);
        if (catalogEntriesEqual(currentEntries, mergedEntries)) return snapshot;
        return settings.save({
          firestoreFieldCatalogs: {
            ...snapshot.firestoreFieldCatalogs,
            [observationKey]: mergedEntries,
          },
        });
      })
      .then((snapshot) => {
        if (!cancelled) setCatalogs(snapshot.firestoreFieldCatalogs);
      })
      .catch((error) => {
        if (!cancelled) {
          onSettingsError?.(messageFromError(error, 'Could not save field catalog settings.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [observationKey, onSettingsError, rows, settings]);

  return catalogs[suggestionKey] ?? [];
}

function collectFields(
  records: ReadonlyArray<TraversalRecord>,
  fields: Map<string, FieldAccumulator>,
  budget: CatalogBudget,
  rowFields: ReadonlyArray<Set<string>>,
) {
  const budgetedFields = new Set<string>();
  const queue: QueueItem[] = [{
    dynamicDepth: 0,
    prefix: '',
    records,
    schemaDepth: 0,
  }];
  while (queue.length) {
    const item = queue.shift()!;
    const nextSchemaDepth = item.schemaDepth + 1;
    if (nextSchemaDepth > FIELD_CATALOG_SCHEMA_DEPTH_LIMIT) continue;

    for (const key of fieldKeysForRecords(item.records)) {
      const field = item.prefix ? `${item.prefix}.${key}` : key;
      if (!reserveFieldVisit(field, fields, budget, budgetedFields)) return;

      const entries = valuesForKey(item.records, key);
      for (const entry of entries) {
        const fieldType = fieldTypeForValue(entry.value);
        if (fieldType) addField(fields, field, fieldType, rowFields[entry.rowIndex]!);
      }

      const nestedRecords = nestedRecordsForValues(entries);
      if (!nestedRecords.length) continue;

      const dynamicMap = dynamicMapInfo(key, entries);
      if (dynamicMap && item.dynamicDepth < DYNAMIC_MAP_DEPTH_LIMIT) {
        queue.push({
          dynamicDepth: item.dynamicDepth + 1,
          prefix: `${field}.${dynamicMap.placeholder}`,
          records: dynamicMap.children,
          schemaDepth: nextSchemaDepth,
        });
        continue;
      }

      queue.push({
        dynamicDepth: item.dynamicDepth,
        prefix: field,
        records: nestedRecords,
        schemaDepth: nextSchemaDepth,
      });
    }
  }
}

function dynamicMapInfo(
  parentKey: string,
  entries: ReadonlyArray<ValueEntry>,
): DynamicMapInfo | null {
  const children: TraversalRecord[] = [];
  let keyCount = 0;
  for (const entry of entries) {
    if (fieldTypeForValue(entry.value)) continue;
    const record = nestedRecord(entry.value);
    if (!record) continue;
    const keys = sortedObjectKeys(record);
    keyCount += keys.length;
    for (const key of keys) {
      const child = nestedRecord(record[key]);
      if (child) children.push({ rowIndex: entry.rowIndex, value: child });
    }
  }
  if (keyCount < DYNAMIC_MAP_MIN_KEYS) return null;
  if (children.length < DYNAMIC_MAP_MIN_KEYS) return null;
  if (children.length / keyCount < 0.75) return null;
  if (!hasRepeatedChildShape(children)) return null;

  return {
    children,
    placeholder: placeholderForDynamicMap(parentKey),
  };
}

function hasRepeatedChildShape(children: ReadonlyArray<TraversalRecord>): boolean {
  const childFieldCounts = new Map<string, number>();
  const sample = children.slice(0, DYNAMIC_MAP_SAMPLE_LIMIT);
  for (const child of sample) {
    for (const key of sortedObjectKeys(child.value)) {
      childFieldCounts.set(key, (childFieldCounts.get(key) ?? 0) + 1);
    }
  }
  const repeatedThreshold = Math.max(
    2,
    Math.ceil(sample.length * DYNAMIC_MAP_REPEATED_FIELD_RATIO),
  );
  const repeatedFieldCount =
    Array.from(childFieldCounts.values()).filter((count) => count >= repeatedThreshold).length;
  return repeatedFieldCount >= DYNAMIC_MAP_MIN_REPEATED_FIELDS;
}

function fieldKeysForRecords(records: ReadonlyArray<TraversalRecord>): string[] {
  const keys = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.value)) keys.add(key);
  }
  return sortedBy(keys, (a, b) => a.localeCompare(b));
}

function valuesForKey(
  records: ReadonlyArray<TraversalRecord>,
  key: string,
): ReadonlyArray<ValueEntry> {
  const values: ValueEntry[] = [];
  for (const record of records) {
    if (Object.hasOwn(record.value, key)) {
      values.push({ rowIndex: record.rowIndex, value: record.value[key] });
    }
  }
  return values;
}

function nestedRecordsForValues(
  entries: ReadonlyArray<ValueEntry>,
): ReadonlyArray<TraversalRecord> {
  const records: TraversalRecord[] = [];
  for (const entry of entries) {
    if (fieldTypeForValue(entry.value)) continue;
    const record = nestedRecord(entry.value);
    if (record) records.push({ rowIndex: entry.rowIndex, value: record });
  }
  return records;
}

function placeholderForDynamicMap(parentKey: string): string {
  const match = /By([A-Z][A-Za-z0-9]*)$/.exec(parentKey);
  const name = match?.[1];
  if (!name || name.toLowerCase() === 'id') return '{id}';
  return `{${name.charAt(0).toLowerCase()}${name.slice(1)}}`;
}

function sortedObjectKeys(value: Record<string, unknown>): string[] {
  return sortedBy(Object.keys(value), (a, b) => a.localeCompare(b));
}

function catalogBudgetExhausted(
  fields: ReadonlyMap<string, unknown>,
  budget: { readonly visits: number; },
): boolean {
  return fields.size >= FIELD_CATALOG_FIELD_LIMIT || budget.visits >= FIELD_CATALOG_VISIT_LIMIT;
}

function reserveFieldVisit(
  field: string,
  fields: ReadonlyMap<string, unknown>,
  budget: CatalogBudget,
  budgetedFields: Set<string>,
): boolean {
  if (budgetedFields.has(field)) return true;
  if (catalogBudgetExhausted(fields, budget)) return false;
  budget.visits += 1;
  budgetedFields.add(field);
  return true;
}

function addField(
  fields: Map<string, FieldAccumulator>,
  field: string,
  type: FirestoreFieldType,
  rowFields: Set<string>,
) {
  const current = fields.get(field) ?? { count: 0, types: new Set<FirestoreFieldType>() };
  if (!rowFields.has(field)) {
    current.count += 1;
    rowFields.add(field);
  }
  current.types.add(type);
  fields.set(field, current);
}

function primitiveFieldType(value: unknown): FirestorePrimitiveFieldType | null {
  return primitiveCatalogTypeForValue(value);
}

function fieldTypeForValue(value: unknown): FirestoreFieldType | null {
  return primitiveFieldType(value) ?? arrayFieldType(value);
}

function arrayFieldType(value: unknown): FirestoreFieldType | null {
  const entries = Array.isArray(value)
    ? value
    : isPlainObject(value) && value['__type__'] === 'array' && Array.isArray(value['value'])
    ? value['value']
    : null;
  if (!entries || entries.length === 0) return null;
  const types = new Set<FirestorePrimitiveFieldType>();
  for (const entry of entries) {
    const type = primitiveFieldType(entry);
    if (!type) return 'array<mixed>';
    types.add(type);
  }
  if (types.size === 1) {
    const [type] = [...types];
    return type ? `array<${type}>` : null;
  }
  return 'array<mixed>';
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  if (value['__type__'] === 'map' && isPlainObject(value['value'])) return value['value'];
  if (typeof value['__type__'] === 'string') return null;
  return value;
}

function sortedEntries(
  fields: ReadonlyMap<string, { count: number; types: ReadonlySet<FirestoreFieldType>; }>,
): FirestoreFieldCatalogEntry[] {
  return sortedBy(
    Array.from(fields, ([field, value]) => ({
      count: value.count,
      field,
      types: sortedTypes(value.types),
    })),
    compareCatalogEntries,
  );
}

function compareCatalogEntries(
  left: FirestoreFieldCatalogEntry,
  right: FirestoreFieldCatalogEntry,
): number {
  const leftDepth = fieldDepth(left.field);
  const rightDepth = fieldDepth(right.field);
  if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  if (left.count !== right.count) return right.count - left.count;
  return left.field.localeCompare(right.field);
}

function fieldDepth(field: string): number {
  return field.split('.').length;
}

function hasPlaceholderSegment(field: string): boolean {
  return field.split('.').some(isPlaceholderSegment);
}

function fieldMatchesPlaceholder(field: string, placeholderField: string): boolean {
  const fieldSegments = field.split('.');
  const placeholderSegments = placeholderField.split('.');
  if (fieldSegments.length !== placeholderSegments.length) return false;
  return placeholderSegments.every((segment, index) =>
    isPlaceholderSegment(segment)
      ? !isPlaceholderSegment(fieldSegments[index] ?? '')
      : segment === fieldSegments[index]
  );
}

function isPlaceholderSegment(segment: string): boolean {
  return /^\{[A-Za-z][A-Za-z0-9]*\}$/.test(segment);
}

function sortedTypes(types: ReadonlySet<FirestoreFieldType>): FirestoreFieldType[] {
  return sortedBy(types, (a, b) => a.localeCompare(b));
}

function sortedBy<T>(items: Iterable<T>, compare: (left: T, right: T) => number): T[] {
  const sorted: T[] = [];
  for (const item of items) {
    const insertAt = sorted.findIndex((existing) => compare(item, existing) < 0);
    if (insertAt === -1) {
      sorted.push(item);
    } else {
      sorted.splice(insertAt, 0, item);
    }
  }
  return sorted;
}

function catalogEntriesEqual(
  left: ReadonlyArray<FirestoreFieldCatalogEntry>,
  right: ReadonlyArray<FirestoreFieldCatalogEntry>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i]!;
    const r = right[i]!;
    if (l.field !== r.field || l.count !== r.count) return false;
    if (l.types.length !== r.types.length) return false;
    for (let j = 0; j < l.types.length; j += 1) {
      if (l.types[j] !== r.types[j]) return false;
    }
  }
  return true;
}
