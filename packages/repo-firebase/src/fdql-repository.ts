import {
  bytesValue,
  compileFdql,
  createProviderDialectRegistry,
  evaluateExpression,
  executeFdql,
  type FdqlAbortSignal,
  type FdqlClearCacheCommandPlan,
  type FdqlExecutionEvent,
  type FdqlExpression,
  type FdqlPersistentCache,
  type FdqlProviderAggregateRequest,
  type FdqlProviderAggregateResult,
  type FdqlProviderReadControls,
  type FdqlProviderReadRequest,
  type FdqlProviderRow,
  type FdqlProviderRuntimeRegistry,
  type FdqlValue,
  firestoreProviderDialect,
  geoPointValue,
  isMissingValue,
  mapValue,
  nullValue,
  numberValue,
  providerValue,
  stringScalar,
  stringValue,
  timestampValue,
  toFdqlValue,
} from '@firebase-desk/fdql';
import type {
  FdqlCompileRequest,
  FdqlCompileResult,
  FdqlDiagnostic,
  FdqlRepository,
  FdqlRunEvent,
  FdqlRunEventListener,
  FdqlRunResult,
  FdqlStats,
} from '@firebase-desk/repo-contracts';
import {
  AggregateField,
  DocumentReference,
  FieldPath,
  Filter,
  type Firestore,
  GeoPoint,
  type Query,
  type QueryDocumentSnapshot,
  Timestamp,
  type WhereFilterOp,
} from 'firebase-admin/firestore';
import type { AdminFirestoreProvider } from './admin-firestore-provider.ts';

const firestoreDialects = createProviderDialectRegistry([firestoreProviderDialect]);

export type {
  FdqlPersistentCache,
  FdqlPersistentCacheClearRequest,
  FdqlPersistentCacheGetRequest,
  FdqlPersistentCacheHit,
  FdqlPersistentCacheKey,
  FdqlPersistentCacheSetRequest,
  FdqlPersistentCacheSetResult,
  FdqlProviderRow,
} from '@firebase-desk/fdql';

export interface FirebaseFdqlRepositoryOptions {
  readonly persistentCache?: FdqlPersistentCache | undefined;
}

export function createFirebaseFdqlRepository(
  provider: AdminFirestoreProvider,
  options: FirebaseFdqlRepositoryOptions = {},
): FdqlRepository {
  const activeRuns = new Map<string, RunAbortController>();
  const listeners = new Set<FdqlRunEventListener>();

  function emit(event: FdqlRunEvent): void {
    for (const listener of listeners) listener(event);
  }

  return {
    async compile(request): Promise<FdqlCompileResult> {
      const compiled = compileFdql(request.source, compileOptions(request));
      return { diagnostics: compiled.diagnostics, ok: compiled.ok };
    },

    async run(request): Promise<FdqlRunResult> {
      const startedAt = Date.now();
      const controller = createRunAbortController();
      activeRuns.set(request.runId, controller);
      emit({ runId: request.runId, type: 'started' });

      const compiled = compileFdql(request.source, compileOptions(request));
      if (!compiled.ok || !compiled.plan) {
        const result = failedCompileResult(compiled.diagnostics, startedAt);
        for (const diagnostic of compiled.diagnostics) {
          emit({ diagnostic, runId: request.runId, type: 'diagnostic' });
        }
        emit({
          diagnostic: compiled.diagnostics[0] ?? fallbackDiagnostic(),
          result,
          runId: request.runId,
          type: 'failed',
        });
        activeRuns.delete(request.runId);
        return result;
      }

      if (compiled.plan.kind === 'clearCache') {
        const result = await clearCacheResult(compiled.plan, options.persistentCache, startedAt);
        emit({ result, runId: request.runId, type: 'completed' });
        activeRuns.delete(request.runId);
        return result;
      }

      const rows: Record<string, unknown>[] = [];
      const rowLineages: Array<NonNullable<FdqlRunResult['rowLineages']>[number]> = [];
      const diagnostics: FdqlDiagnostic[] = [];
      let stats: FdqlStats | null = null;
      let cancelled = false;
      const runtime = createAdminFdqlRuntime(provider);

      for await (
        const event of executeFdql(
          compiled.plan,
          runtime,
          {
            cacheContext: { connectionId: request.connectionId, profile: 'desktop' },
            persistentCache: options.persistentCache,
            signal: controller.signal,
          },
        )
      ) {
        const mapped = eventToRunEvent(request.runId, event);
        if (mapped) emit(mapped);
        if (event.kind === 'row') {
          rows.push(event.row);
          if (event.lineage) rowLineages.push(event.lineage);
        }
        if (event.kind === 'diagnostic' || event.kind === 'failed') {
          diagnostics.push(event.diagnostic);
        }
        if (event.kind === 'stats' || event.kind === 'completed' || event.kind === 'cancelled') {
          stats = event.stats;
        }
        if (event.kind === 'cancelled') cancelled = true;
      }

      const result: FdqlRunResult = {
        ...(cancelled ? { cancelled: true } : {}),
        diagnostics,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(rowLineages.length > 0 ? { rowLineages } : {}),
        rows,
        stats,
      };
      if (cancelled) emit({ result, runId: request.runId, type: 'cancelled' });
      else if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        emit({
          diagnostic: diagnostics[0] ?? fallbackDiagnostic(),
          result,
          runId: request.runId,
          type: 'failed',
        });
      } else {
        emit({ result, runId: request.runId, type: 'completed' });
      }
      activeRuns.delete(request.runId);
      return result;
    },

    async cancel(runId): Promise<void> {
      activeRuns.get(runId)?.abort();
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createAdminFdqlRuntime(provider: AdminFirestoreProvider): FdqlProviderRuntimeRegistry {
  return {
    dialects: firestoreDialects,
    providers: {
      fs: {
        async aggregate(request, controls) {
          return aggregateFirestore(request, controls, provider);
        },
        async *read(request, controls) {
          const projectId = stringTarget(request, 'projectId');
          const databaseId = optionalStringTarget(request, 'databaseId');
          const { db } = await provider.getFirestoreConnection(projectId, databaseId);
          const collectionPath = optionalStringTarget(request, 'collectionPath');
          const collectionGroup = optionalStringTarget(request, 'collectionGroup');
          const base = collectionPath
            ? db.collection(collectionPath)
            : db.collectionGroup(collectionGroup ?? '');
          const query = applyProviderQuery(db, base, request);
          let readCount = 0;
          let lastDocument: QueryDocumentSnapshot | null = null;
          // oxlint-disable no-await-in-loop -- Each page depends on the previous cursor.
          while (readCount < request.maxDocuments && !controlsStopped(controls)) {
            const pageLimit = Math.min(request.pageSize, request.maxDocuments - readCount);
            let pageQuery = query.limit(pageLimit);
            if (lastDocument) pageQuery = pageQuery.startAfter(lastDocument);
            const snapshot = await raceWithReadControls(pageQuery.get(), controls);
            if (!snapshot || controlsStopped(controls)) break;
            if (!snapshot.docs.length) break;
            for (const doc of snapshot.docs) {
              if (controlsStopped(controls)) break;
              readCount += 1;
              lastDocument = doc;
              yield rowFromSnapshot(request, doc);
              if (readCount >= request.maxDocuments) break;
            }
            if (snapshot.docs.length < pageLimit) break;
          }
          // oxlint-enable no-await-in-loop
        },
      },
    },
  };
}

async function aggregateFirestore(
  request: FdqlProviderAggregateRequest,
  controls: FdqlProviderReadControls,
  provider: AdminFirestoreProvider,
): Promise<FdqlProviderAggregateResult> {
  const projectId = stringTarget(request, 'projectId');
  const databaseId = optionalStringTarget(request, 'databaseId');
  const { db } = await provider.getFirestoreConnection(projectId, databaseId);
  const collectionPath = optionalStringTarget(request, 'collectionPath');
  const collectionGroup = optionalStringTarget(request, 'collectionGroup');
  const base = collectionPath
    ? db.collection(collectionPath)
    : db.collectionGroup(collectionGroup ?? '');
  const query = applyProviderWhere(db, base, request);
  const nativeItems = request.aggregates.filter((item) =>
    ['fs.avg', 'fs.count', 'fs.sum'].includes(item.functionName)
  );
  const minMaxItems = request.aggregates.filter((item) =>
    ['fs.max', 'fs.min'].includes(item.functionName)
  );
  const values: Record<string, FdqlValue> = {};
  let aggregateReads = 0;
  if (nativeItems.length) {
    const snapshot = await raceWithReadControls(
      aggregateQuery(query, nativeItems, request.rowAlias).get(),
      controls,
    );
    const data = snapshot?.data() ?? {};
    aggregateReads += snapshot ? 1 : 0;
    for (const item of nativeItems) {
      values[item.alias] = aggregateValueFromNative(item.functionName, data[item.alias]);
    }
  }
  const documentReads: FdqlProviderRow[] = [];
  // oxlint-disable no-await-in-loop -- Each min/max aggregate is a separate bounded Firestore read.
  for (const item of minMaxItems) {
    if (controlsStopped(controls)) break;
    const field = item.expression
      ? fieldPathFromExpression(item.expression, request.rowAlias)
      : '__missing__';
    const direction = item.functionName === 'fs.max' ? 'desc' : 'asc';
    const snapshot = await raceWithReadControls(
      query.orderBy(field, direction).limit(1).select(
        typeof field === 'string' ? new FieldPath(field) : field,
      ).get(),
      controls,
    );
    const doc = snapshot?.docs[0];
    if (!doc) {
      values[item.alias] = nullValue;
      continue;
    }
    const row = rowFromSnapshot(readRequestForAggregate(request), doc);
    documentReads.push(row);
    values[item.alias] = item.expression
      ? evaluateExpression(item.expression, {
        aliases: request.aliases,
        providers: firestoreDialects,
        rows: { ...request.rows, [request.rowAlias]: row },
      })
      : nullValue;
  }
  // oxlint-enable no-await-in-loop
  return { aggregateReads, documentReads, values };
}

function aggregateQuery(
  query: Query,
  items: readonly FdqlProviderAggregateRequest['aggregates'][number][],
  rowAlias: string,
) {
  return query.aggregate(Object.fromEntries(items.map((item) => [
    item.alias,
    aggregateField(item, rowAlias),
  ])));
}

function aggregateField(
  item: FdqlProviderAggregateRequest['aggregates'][number],
  rowAlias: string,
) {
  if (item.functionName === 'fs.count') return AggregateField.count();
  const field = item.expression
    ? fieldPathFromExpression(item.expression, rowAlias)
    : '__missing__';
  if (item.functionName === 'fs.avg') return AggregateField.average(field);
  return AggregateField.sum(field);
}

function aggregateValueFromNative(functionName: string, value: unknown): FdqlValue {
  if (typeof value === 'number') return numberValue(value);
  if (functionName === 'fs.count' || functionName === 'fs.sum') return numberValue(0);
  return nullValue;
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

function applyProviderQuery(
  db: Firestore,
  query: Query,
  request: FdqlProviderReadRequest,
): Query {
  let next = query;
  next = applyProviderWhere(db, next, request);
  if (request.orderBy) {
    next = next.orderBy(
      fieldPathFromExpression(request.orderBy.expression, request.rowAlias),
      request.orderBy.direction,
    );
  }
  if (request.fieldMask) {
    next = next.select(...request.fieldMask.map((field) => toAdminFieldPath(field.segments)));
  }
  return next;
}

function applyProviderWhere(
  db: Firestore,
  query: Query,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): Query {
  const filter = request.predicate ? filterFromExpression(db, request.predicate, request) : null;
  return filter ? query.where(filter) : query;
}

function filterFromExpression(
  db: Firestore,
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): Filter | null {
  if (expression.kind === 'binary' && expression.operator === 'and') {
    return Filter.and(
      ...[
        filterFromExpression(db, expression.left, request),
        filterFromExpression(db, expression.right, request),
      ]
        .filter((filter): filter is Filter => Boolean(filter)),
    );
  }
  if (expression.kind === 'binary' && expression.operator === 'or') {
    return Filter.or(
      ...[
        filterFromExpression(db, expression.left, request),
        filterFromExpression(db, expression.right, request),
      ]
        .filter((filter): filter is Filter => Boolean(filter)),
    );
  }
  if (expression.kind === 'binary') {
    const value = valueFor(db, expression.right, request);
    validateProviderFilterValue(expression.operator, value, expression, request);
    return Filter.where(
      fieldPathFromExpression(expression.left, request.rowAlias),
      operatorFor(expression.operator),
      value,
    );
  }
  if (expression.kind === 'postfix') {
    if (expression.operator === 'is null' || expression.operator === 'is not null') {
      return Filter.where(
        fieldPathFromExpression(expression.expression, request.rowAlias),
        expression.operator === 'is null' ? '==' : '!=',
        null,
      );
    }
    return null;
  }
  if (
    expression.kind === 'call'
    && (expression.name === 'fs.arrayContains' || expression.name === 'fs.arrayContainsAny')
  ) {
    const value = valueFor(db, expression.args[1]!, request);
    if (expression.name === 'fs.arrayContainsAny') {
      validateArrayFilterValue('arrayContainsAny', value, expression, request);
    }
    return Filter.where(
      fieldPathFromExpression(expression.args[0]!, request.rowAlias),
      expression.name === 'fs.arrayContains' ? 'array-contains' : 'array-contains-any',
      value,
    );
  }
  return null;
}

function fieldPathFromExpression(expression: FdqlExpression, rowAlias: string): string | FieldPath {
  if (expression.kind === 'call' && expression.name === 'fs.id') return FieldPath.documentId();
  if (expression.kind === 'call' && expression.name === 'fs.fieldPath') {
    return toAdminFieldPath(fieldPathSegments(expression));
  }
  if (expression.kind === 'field') {
    return new FieldPath(...expression.path.slice(expression.path[0] === rowAlias ? 1 : 0));
  }
  return new FieldPath('__unsupported__');
}

function fieldPathSegments(
  expression: Extract<FdqlExpression, { readonly kind: 'call'; }>,
): readonly string[] {
  return expression.args.flatMap((arg) =>
    arg.kind === 'literal' && typeof arg.value === 'string' ? [arg.value] : []
  );
}

async function raceWithReadControls<T>(
  promise: Promise<T>,
  controls: FdqlProviderReadControls,
): Promise<T | null> {
  if (controlsStopped(controls)) return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const stopped = new Promise<null>((resolve) => {
    const remainingMs = Math.max(0, controls.deadlineAtMs - controls.now());
    timeoutId = setTimeout(() => resolve(null), remainingMs);
    if (controls.signal?.addEventListener) {
      abortListener = () => resolve(null);
      controls.signal.addEventListener('abort', abortListener, { once: true });
    }
  });
  try {
    return await Promise.race([promise, stopped]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortListener) controls.signal?.removeEventListener?.('abort', abortListener);
  }
}

function controlsStopped(controls: FdqlProviderReadControls): boolean {
  return Boolean(controls.signal?.aborted) || controls.now() >= controls.deadlineAtMs;
}

function stringTarget(
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
  key: string,
): string {
  const value = request.source.target[key];
  return typeof value === 'string' ? value : '';
}

function optionalStringTarget(
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
  key: string,
): string | undefined {
  const value = stringTarget(request, key);
  return value ? value : undefined;
}

function operatorFor(
  operator: Extract<FdqlExpression, { readonly kind: 'binary'; }>['operator'],
): WhereFilterOp {
  if (operator === '=') return '==';
  if (operator === '!=') return '!=';
  if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
    return operator;
  }
  if (operator === 'in') return 'in';
  if (operator === 'not in') return 'not-in';
  return '==';
}

function validateProviderFilterValue(
  operator: Extract<FdqlExpression, { readonly kind: 'binary'; }>['operator'],
  value: unknown,
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): void {
  if (operator === 'in') validateArrayFilterValue('in', value, expression, request);
  if (operator === 'not in') validateArrayFilterValue('not in', value, expression, request);
}

function validateArrayFilterValue(
  operator: 'arrayContainsAny' | 'in' | 'not in',
  value: unknown,
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): void {
  const max = operator === 'not in' ? 10 : 30;
  if (Array.isArray(value) && value.length > 0 && value.length <= max) return;
  throw errorForExpression(
    `${
      operator === 'arrayContainsAny' ? operator : `\`${operator}\``
    } needs 1 to ${max} comparison values.`,
    expression,
    request,
  );
}

function valueFor(
  db: Firestore,
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): unknown {
  const value = evaluateExpression(expression, {
    aliases: request.aliases,
    providers: firestoreDialects,
    rows: request.rows,
  });
  if (isMissingValue(value)) {
    throw errorForExpression(
      `Firestore filter value resolved to missing for ${expressionLabel(expression)}. `
        + `Add a local filter before this lookup, for example `
        + `then filter ${expressionLabel(expression)}, or ensure the field exists.`,
      expression,
      request,
    );
  }
  const adminValue = toAdminValue(db, value);
  if (adminValue === undefined) {
    throw errorForExpression(
      `Firestore filter value could not be encoded for ${expressionLabel(expression)}.`,
      expression,
      request,
    );
  }
  return adminValue;
}

function errorForExpression(
  message: string,
  expression: FdqlExpression,
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): Error {
  const error = new Error(message) as Error & {
    column?: number;
    context?: FdqlDiagnostic['context'];
    line?: number;
  };
  if (expression.range) {
    error.column = expression.range.startColumn;
    error.line = expression.range.startLine;
  }
  error.context = {
    provider: request.source.provider,
    rowAlias: request.rowAlias,
    ...(correlatedRowPath(request) ? { rowPath: correlatedRowPath(request) } : {}),
    source: request.source.sourceAlias,
    stage: request.stage,
  };
  return error;
}

function correlatedRowPath(
  request: FdqlProviderAggregateRequest | FdqlProviderReadRequest,
): string | undefined {
  if (!request.rows) return undefined;
  for (const value of Object.values(request.rows)) {
    if (isProviderRow(value)) return value.path;
  }
  return undefined;
}

function isProviderRow(value: unknown): value is FdqlProviderRow {
  return value !== null
    && typeof value === 'object'
    && 'path' in value
    && 'provider' in value
    && 'source' in value;
}

function expressionLabel(expression: FdqlExpression): string {
  switch (expression.kind) {
    case 'alias':
      return expression.name;
    case 'array':
      return `[${expression.items.map(expressionLabel).join(', ')}]`;
    case 'binary':
      return `${expressionLabel(expression.left)} ${expression.operator} ${
        expressionLabel(expression.right)
      }`;
    case 'call':
      return `${expression.name}(${expression.args.map(expressionLabel).join(', ')})`;
    case 'case':
      return 'case';
    case 'field':
      return expression.path.join('.');
    case 'literal':
      return JSON.stringify(expression.value);
    case 'map':
      return `{${
        expression.entries.map((entry) => `${entry.key}: ${expressionLabel(entry.value)}`).join(
          ', ',
        )
      }}`;
    case 'postfix':
      return `${expressionLabel(expression.expression)} ${expression.operator}`;
    case 'unary':
      return `${expression.operator === 'negate' ? '-' : expression.operator} ${
        expressionLabel(expression.expression)
      }`;
    case 'wildcard':
      return '*';
  }
}

function compileOptions(request: FdqlCompileRequest) {
  return {
    defaultProviderContext: {
      fs: { projectId: request.defaultProjectId ?? request.connectionId },
    },
    executionDefaults: {
      allowUnboundedReads: request.execution?.allowUnboundedReads ?? false,
      cache: request.execution?.cache ?? 'off',
      cacheTtlMs: request.execution?.cacheTtlMs ?? 86_400_000,
      pageSize: request.execution?.pageSize ?? 100,
      readBudget: request.execution?.readBudget ?? 5000,
      timeoutMs: request.execution?.timeoutMs ?? 60_000,
    },
    providers: [firestoreProviderDialect],
  };
}

interface RunAbortController {
  readonly signal: FdqlAbortSignal;
  abort(): void;
}

function createRunAbortController(): RunAbortController {
  const NativeAbortController = (globalThis as unknown as {
    readonly AbortController?: new() => RunAbortController;
  }).AbortController;
  if (NativeAbortController) return new NativeAbortController();
  const listeners = new Set<() => void>();
  let aborted = false;
  return {
    signal: {
      addEventListener(_type, listener) {
        listeners.add(listener);
      },
      get aborted() {
        return aborted;
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener);
      },
    },
    abort() {
      if (aborted) return;
      aborted = true;
      for (const listener of listeners) listener();
      listeners.clear();
    },
  };
}

function rowFromSnapshot(
  request: FdqlProviderReadRequest,
  snapshot: QueryDocumentSnapshot,
): FdqlProviderRow {
  const projectId = stringTarget(request, 'projectId');
  const databaseId = optionalStringTarget(request, 'databaseId');
  return {
    context: {
      ...(databaseId ? { databaseId } : {}),
      collectionPath: snapshot.ref.parent.path,
      projectId,
    },
    data: normalizeAdminRecord(request, snapshot.data()),
    id: snapshot.id,
    path: snapshot.ref.path,
    provider: request.source.provider,
    source: request.source,
  };
}

function normalizeAdminRecord(
  request: FdqlProviderReadRequest,
  data: Record<string, unknown>,
): Record<string, FdqlValue> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, normalizeAdminValue(request, value)]),
  );
}

function normalizeAdminValue(request: FdqlProviderReadRequest, value: unknown): FdqlValue {
  if (value instanceof Timestamp) return timestampValue(value.toDate().toISOString());
  if (value instanceof Date) return timestampValue(value.toISOString());
  if (value instanceof GeoPoint) return geoPointValue(value.latitude, value.longitude);
  if (value instanceof DocumentReference) return documentRefValue(request, value.path);
  if (Buffer.isBuffer(value)) return bytesValue(value.toString('base64'));
  if (value instanceof Uint8Array) return bytesValue(Buffer.from(value).toString('base64'));
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      value: value.map((item) => normalizeAdminValue(request, item)),
    };
  }
  if (isPlainObject(value)) {
    return mapValue(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, normalizeAdminValue(request, entry)]),
      ),
    );
  }
  return toFdqlValue(value);
}

function documentRefValue(request: FdqlProviderReadRequest, path: string): FdqlValue {
  const projectId = stringTarget(request, 'projectId');
  const databaseId = optionalStringTarget(request, 'databaseId') ?? '(default)';
  return providerValue({
    display: path,
    equalityKey: `fs:${projectId}:${databaseId}:${path}`,
    provider: 'fs',
    value: {
      databaseId: stringValue(databaseId),
      path: stringValue(path),
      projectId: stringValue(projectId),
    },
    valueType: 'documentRef',
  });
}

function toAdminValue(db: Firestore, value: FdqlValue): unknown {
  switch (value.kind) {
    case 'missing':
      return undefined;
    case 'null':
      return null;
    case 'boolean':
    case 'number':
    case 'string':
      return value.value;
    case 'array':
      return value.value.map((item) => toAdminValue(db, item));
    case 'map':
      return Object.fromEntries(
        Object.entries(value.value).map(([key, entry]) => [key, toAdminValue(db, entry)]),
      );
    case 'timestamp':
      return Timestamp.fromDate(new Date(value.iso));
    case 'bytes':
      return Buffer.from(value.base64, 'base64');
    case 'geoPoint':
      return new GeoPoint(value.latitude, value.longitude);
    case 'providerValue':
      if (value.provider === 'fs' && value.valueType === 'documentRef') {
        const path = stringScalar(value.value['path'] ?? toFdqlValue(undefined));
        return path ? db.doc(path) : undefined;
      }
      return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toAdminFieldPath(segments: readonly string[]): FieldPath {
  return new FieldPath(...segments);
}

function eventToRunEvent(runId: string, event: FdqlExecutionEvent): FdqlRunEvent | null {
  switch (event.kind) {
    case 'started':
      return null;
    case 'diagnostic':
      return { diagnostic: event.diagnostic, runId, type: 'diagnostic' };
    case 'read':
      return {
        count: event.count,
        provider: event.provider,
        runId,
        source: event.source,
        type: 'read',
      };
    case 'row':
      return {
        ...(event.lineage ? { lineage: event.lineage } : {}),
        row: event.row,
        runId,
        type: 'row',
      };
    case 'stats':
      return { runId, stats: event.stats, type: 'stats' };
    case 'completed':
    case 'cancelled':
    case 'failed':
      return null;
  }
}

function failedCompileResult(
  diagnostics: readonly FdqlDiagnostic[],
  startedAt: number,
): FdqlRunResult {
  return {
    diagnostics,
    durationMs: Math.max(0, Date.now() - startedAt),
    rows: [],
    stats: null,
  };
}

async function clearCacheResult(
  plan: FdqlClearCacheCommandPlan,
  persistentCache: FdqlPersistentCache | undefined,
  startedAt: number,
): Promise<FdqlRunResult> {
  const result = await persistentCache?.clear?.({
    profile: 'desktop',
    ...(plan.projectId ? { projectId: plan.projectId } : {}),
    ...(plan.provider ? { provider: plan.provider } : {}),
  }) ?? { clearedEntries: 0 };
  return {
    command: {
      clearedEntries: result.clearedEntries,
      kind: 'clearCache',
      message: `Cleared ${result.clearedEntries} cache ${
        result.clearedEntries === 1 ? 'entry' : 'entries'
      }.`,
    },
    diagnostics: [],
    durationMs: Math.max(0, Date.now() - startedAt),
    rows: [],
    stats: null,
  };
}

function fallbackDiagnostic(): FdqlDiagnostic {
  return {
    code: 'FDQL_COMPILE_FAILED',
    message: 'FDQL compile failed.',
    severity: 'error',
  };
}
