import {
  compareValues,
  createProviderDialectRegistry,
  evaluateExpression,
  type FdqlProviderAggregateRequest,
  type FdqlProviderReadRequest,
  type FdqlProviderRow,
  type FdqlProviderRuntimeRegistry,
  type FdqlValue,
  isMissingValue,
  mapValue,
  missingValue,
  nullValue,
  numberValue,
  numericValue,
  toFdqlValue,
  truthy,
} from '@firebase-desk/fdql-core';
import { firestoreProviderDialect } from '../fs-dialect.ts';

export interface TestFirestoreRuntimeInput {
  readonly projects: Readonly<Record<string, TestFirestoreProject>>;
}

export type TestFirestoreProject = Readonly<
  Record<string, Readonly<Record<string, Record<string, unknown>>>>
>;

export function createTestFirestoreRuntime(
  input: TestFirestoreRuntimeInput,
): FdqlProviderRuntimeRegistry {
  const dialects = createProviderDialectRegistry([firestoreProviderDialect]);
  return {
    dialects,
    providers: {
      fs: {
        async aggregate(request) {
          const projectId = stringTarget(request, 'projectId');
          const project = input.projects[projectId] ?? {};
          const rows = filteredAggregateRows(project, request, dialects);
          return {
            aggregateReads:
              request.aggregates.some((item) =>
                  ['fs.avg', 'fs.count', 'fs.sum'].includes(item.functionName)
                )
                ? 1
                : 0,
            documentReads:
              request.aggregates.some((item) => ['fs.max', 'fs.min'].includes(item.functionName))
                ? rows.slice(0, 1)
                : [],
            values: aggregateValues(request, rows, dialects),
          };
        },
        async *read(request) {
          const projectId = stringTarget(request, 'projectId');
          const project = input.projects[projectId] ?? {};
          const documents = readDocuments(project, request);
          const filtered = documents.filter((document) =>
            !request.predicate
            || truthy(evaluateExpression(request.predicate, {
              aliases: request.aliases,
              providers: dialects,
              rows: { ...request.rows, [request.rowAlias]: document },
            }))
          );
          for (const document of orderDocuments(filtered, request).slice(0, request.maxDocuments)) {
            yield applyFieldMask(document, request);
          }
        },
      },
    },
  };
}

function filteredAggregateRows(
  project: TestFirestoreProject,
  request: FdqlProviderAggregateRequest,
  dialects: ReturnType<typeof createProviderDialectRegistry>,
): readonly FdqlProviderRow[] {
  return readDocuments(project, readRequestForAggregate(request))
    .filter((document) =>
      !request.predicate
      || truthy(evaluateExpression(request.predicate, {
        aliases: request.aliases,
        providers: dialects,
        rows: { ...request.rows, [request.rowAlias]: document },
      }))
    );
}

function readRequestForAggregate(
  request: FdqlProviderAggregateRequest,
): FdqlProviderReadRequest {
  return {
    aliases: request.aliases,
    maxDocuments: request.maxDocuments,
    pageSize: request.maxDocuments,
    ...(request.predicate ? { predicate: request.predicate } : {}),
    rowAlias: request.rowAlias,
    ...(request.rows ? { rows: request.rows } : {}),
    source: request.source,
    stage: 'lookup',
  };
}

function aggregateValues(
  request: FdqlProviderAggregateRequest,
  rows: readonly FdqlProviderRow[],
  dialects: ReturnType<typeof createProviderDialectRegistry>,
): Record<string, FdqlValue> {
  return Object.fromEntries(
    request.aggregates.map((item) => [
      item.alias,
      aggregateValue(request, rows, dialects, item.functionName, item.expression),
    ]),
  );
}

function aggregateValue(
  request: FdqlProviderAggregateRequest,
  rows: readonly FdqlProviderRow[],
  dialects: ReturnType<typeof createProviderDialectRegistry>,
  functionName: string,
  expression: Parameters<typeof evaluateExpression>[0] | undefined,
): FdqlValue {
  if (functionName === 'fs.count') return numberValue(rows.length);
  const values = rows.map((row) =>
    expression
      ? evaluateExpression(expression, {
        aliases: request.aliases,
        providers: dialects,
        rows: { ...request.rows, [request.rowAlias]: row },
      })
      : missingValue
  ).filter((value) => value.kind !== 'missing' && value.kind !== 'null');
  if (functionName === 'fs.sum') {
    return numberValue(values.reduce((total, value) => total + numericValue(value), 0));
  }
  if (functionName === 'fs.avg') {
    return values.length
      ? numberValue(values.reduce((total, value) => total + numericValue(value), 0) / values.length)
      : nullValue;
  }
  if (functionName === 'fs.min' || functionName === 'fs.max') {
    const direction = functionName === 'fs.max' ? 1 : -1;
    let selected: FdqlValue = nullValue;
    for (const value of values) {
      if (selected.kind === 'null' || compareValues(value, selected) * direction > 0) {
        selected = value;
      }
    }
    return selected;
  }
  return nullValue;
}

function readDocuments(
  project: TestFirestoreProject,
  request: FdqlProviderReadRequest,
): readonly FdqlProviderRow[] {
  const collectionPathTarget = stringTarget(request, 'collectionPath');
  const collectionGroupTarget = stringTarget(request, 'collectionGroup');
  const projectId = stringTarget(request, 'projectId');
  const databaseId = stringTarget(request, 'databaseId');
  const entries = Object.entries(project).filter(([collectionPath]) =>
    collectionPathTarget
      ? collectionPath === collectionPathTarget
      : collectionPath.split('/').at(-1) === collectionGroupTarget
  );
  return entries.flatMap(([collectionPath, documents]) =>
    Object.entries(documents).map(([id, data]) => ({
      context: {
        ...(databaseId ? { databaseId } : {}),
        collectionPath,
        projectId,
      },
      data: normalizeRecord(data),
      id,
      path: `${collectionPath}/${id}`,
      provider: request.source.provider,
      source: request.source,
    }))
  );
}

function orderDocuments(
  documents: readonly FdqlProviderRow[],
  request: FdqlProviderReadRequest,
): readonly FdqlProviderRow[] {
  if (!request.orderBy) return documents;
  const direction = request.orderBy.direction === 'desc' ? -1 : 1;
  const sorted: FdqlProviderRow[] = [];
  for (const document of documents) {
    const index = sorted.findIndex((candidate) =>
      compareDocuments(document, candidate, request, direction) < 0
    );
    if (index < 0) sorted.push(document);
    else sorted.splice(index, 0, document);
  }
  return sorted;
}

function compareDocuments(
  left: FdqlProviderRow,
  right: FdqlProviderRow,
  request: FdqlProviderReadRequest,
  direction: number,
): number {
  if (!request.orderBy) return 0;
  const leftValue = evaluateExpression(request.orderBy.expression, {
    aliases: request.aliases,
    providers: { fs: firestoreProviderDialect },
    rows: { ...request.rows, [request.rowAlias]: left },
  });
  const rightValue = evaluateExpression(request.orderBy.expression, {
    aliases: request.aliases,
    providers: { fs: firestoreProviderDialect },
    rows: { ...request.rows, [request.rowAlias]: right },
  });
  return compareValues(leftValue, rightValue) * direction;
}

function applyFieldMask(
  document: FdqlProviderRow,
  request: FdqlProviderReadRequest,
): FdqlProviderRow {
  if (!request.fieldMask) return document;
  const data: Record<string, FdqlValue> = {};
  for (const field of request.fieldMask) {
    const value = readPath(document.data, field.segments);
    if (!isMissingValue(value)) writePath(data, field.segments, value);
  }
  return { ...document, data };
}

function stringTarget(
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
  key: string,
): string {
  const value = request.source.target[key];
  return typeof value === 'string' ? value : '';
}

function readPath(
  source: Readonly<Record<string, FdqlValue>>,
  segments: readonly string[],
): FdqlValue {
  return segments.reduce<FdqlValue>((value, segment) => {
    if (value.kind !== 'map') return missingValue;
    return value.value[segment] ?? missingValue;
  }, mapValue(source));
}

function writePath(
  target: Record<string, FdqlValue>,
  segments: readonly string[],
  value: FdqlValue,
): void {
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || existing.kind !== 'map') current[segment] = mapValue({});
    current = (current[segment] as Extract<FdqlValue, { readonly kind: 'map'; }>).value as Record<
      string,
      FdqlValue
    >;
  }
  const leaf = segments.at(-1);
  if (leaf) current[leaf] = value;
}

function normalizeRecord(data: Readonly<Record<string, unknown>>): Record<string, FdqlValue> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      isFdqlValue(value) ? value : toFdqlValue(value),
    ]),
  );
}

function isFdqlValue(value: unknown): value is FdqlValue {
  return value !== null && typeof value === 'object' && 'kind' in value;
}
