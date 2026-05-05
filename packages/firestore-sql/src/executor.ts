import type { AnalysisDiagnostic } from './analyzer.ts';
import type { FieldSegment, FirestoreSqlExpression, SelectColumn } from './parser.ts';
import type {
  FirestoreSqlPlan,
  JoinPlanStage,
  PlanStage,
  ProjectPlanStage,
  ReadPlanStage,
  SourcePlan,
  UnionBranchPlanStage,
} from './planner.ts';

export type FirestoreSqlDocumentData = Record<string, unknown>;

export interface FirestoreSqlRuntimeDocument {
  readonly collectionPath: string;
  readonly data: FirestoreSqlDocumentData;
  readonly id: string;
  readonly path?: string;
  readonly projectId: string;
}

export interface FirestoreSqlRuntimeCollection {
  readonly id: string;
  readonly parentPath: string;
  readonly path: string;
  readonly projectId: string;
}

export interface FirestoreSqlReadRequest {
  readonly collectionGroup?: string;
  readonly collectionPath?: string;
  readonly limit?: number;
  readonly pageSize: number;
  readonly projectId: string;
  readonly select?: readonly FirestoreSqlSelectField[];
}

export interface FirestoreSqlSubcollectionRequest {
  readonly limit?: number;
  readonly name: string;
  readonly pageSize: number;
  readonly parent: FirestoreSqlRuntimeDocument;
  readonly select?: readonly FirestoreSqlSelectField[];
}

export interface FirestoreSqlSelectField {
  readonly segments: readonly string[];
}

export interface FirestoreSqlRuntime {
  readCollection(
    request: FirestoreSqlReadRequest & {
      readonly collectionPath: string;
    },
  ): AsyncIterable<FirestoreSqlRuntimeDocument>;
  readCollectionGroup(
    request: FirestoreSqlReadRequest & {
      readonly collectionGroup: string;
    },
  ): AsyncIterable<FirestoreSqlRuntimeDocument>;
  readSubcollection(request: FirestoreSqlSubcollectionRequest): AsyncIterable<
    FirestoreSqlRuntimeDocument
  >;
  listSubcollections(parent: FirestoreSqlRuntimeDocument): Promise<
    ReadonlyArray<FirestoreSqlRuntimeCollection>
  >;
}

export interface InMemoryFirestoreSqlRuntime {
  readonly projects: FirestoreSqlRuntimeProjects;
}

export type FirestoreSqlRuntimeProjects = Record<
  string,
  Record<string, Record<string, FirestoreSqlDocumentData>>
>;

export type FirestoreSqlStopReason = 'budget' | 'cancelled' | 'completed' | 'timeout';

export interface FirestoreSqlExecutionOptions {
  readonly readBudget?: number;
  readonly signal?: FirestoreSqlAbortSignal;
  readonly timeoutMs?: number;
}

export interface FirestoreSqlAbortSignal {
  readonly aborted: boolean;
}

export interface ExecutionStats {
  readonly joinMisses: number;
  readonly perProjectReads: Readonly<Record<string, number>>;
  readonly readBudget: number;
  readonly reads: number;
  readonly rowsOutput: number;
  readonly rowsScanned: number;
  readonly stoppedReason?: FirestoreSqlStopReason;
  readonly writes: number;
}

export type ExecutionEvent =
  | CancelledExecutionEvent
  | CompletedExecutionEvent
  | DiagnosticExecutionEvent
  | FailedExecutionEvent
  | PlanExecutionEvent
  | ReadExecutionEvent
  | RowExecutionEvent
  | StartedExecutionEvent
  | StatsExecutionEvent;

export interface StartedExecutionEvent {
  readonly kind: 'started';
  readonly planKind: FirestoreSqlPlan['kind'];
  readonly runId?: string;
}

export interface PlanExecutionEvent {
  readonly kind: 'plan';
  readonly plan: FirestoreSqlPlan;
}

export interface DiagnosticExecutionEvent {
  readonly diagnostic: AnalysisDiagnostic;
  readonly kind: 'diagnostic';
}

export interface ReadExecutionEvent {
  readonly collectionGroup?: string;
  readonly collectionPath?: string;
  readonly count: number;
  readonly kind: 'read';
  readonly projectId: string;
}

export interface FirestoreSqlRowLineage {
  readonly baseSource?: string;
  readonly joinedSources: readonly string[];
  readonly localSources: readonly string[];
  readonly readContribution: number;
  readonly unionBranch?: number;
}

export interface RowExecutionEvent {
  readonly kind: 'row';
  readonly lineage: FirestoreSqlRowLineage;
  readonly row: Record<string, unknown>;
}

export interface StatsExecutionEvent {
  readonly kind: 'stats';
  readonly stats: ExecutionStats;
}

export interface CompletedExecutionEvent {
  readonly kind: 'completed';
  readonly stats: ExecutionStats;
  readonly stoppedReason?: FirestoreSqlStopReason;
}

export interface CancelledExecutionEvent {
  readonly kind: 'cancelled';
  readonly stats: ExecutionStats;
}

export interface FailedExecutionEvent {
  readonly diagnostic: AnalysisDiagnostic;
  readonly kind: 'failed';
}

interface MutableExecutionStats {
  joinMisses: number;
  perProjectReads: Record<string, number>;
  readBudget: number;
  reads: number;
  rowsOutput: number;
  rowsScanned: number;
  stoppedReason?: FirestoreSqlStopReason;
  writes: number;
}

type RuntimeSourceValue =
  | RuntimeDocumentValue
  | RuntimeEntryValue
  | RuntimeScalarValue
  | RuntimeSubcollectionValue;

interface RuntimeDocumentValue extends FirestoreSqlRuntimeDocument {
  readonly kind: 'document';
  readonly path: string;
}

interface RuntimeEntryValue {
  readonly data: FirestoreSqlDocumentData;
  readonly id: string;
  readonly kind: 'entry';
  readonly value: unknown;
}

interface RuntimeScalarValue {
  readonly data: FirestoreSqlDocumentData;
  readonly id: string;
  readonly kind: 'scalar';
  readonly value: unknown;
}

interface RuntimeSubcollectionValue {
  readonly data: FirestoreSqlDocumentData;
  readonly id: string;
  readonly kind: 'subcollection';
  readonly parentPath: string;
  readonly path: string;
  readonly projectId: string;
}

interface WorkingRow {
  readonly context: Readonly<Record<string, RuntimeSourceValue | undefined>>;
  readonly lineage: FirestoreSqlRowLineage;
  readonly primary: RuntimeSourceValue | undefined;
}

interface ExecutionControls {
  readonly limit?: number;
  readonly pageSize: number;
  readonly readBudget: number;
  readonly timeoutMs: number;
}

interface SelectRun {
  readonly readEvents: readonly ReadExecutionEvent[];
  readonly rows: readonly WorkingRow[];
}

interface SourceReadOptions {
  readonly limit?: number;
  readonly select?: readonly FirestoreSqlSelectField[];
}

interface SourceProjectionState {
  readonly aliases: ReadonlySet<string>;
  readonly disabled: Set<string>;
  readonly fields: Map<string, Map<string, FirestoreSqlSelectField>>;
  readonly primaryAlias?: string;
}

const DEFAULT_READ_BUDGET = 5000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 60_000;

export async function* executeFirestoreSql(
  plan: FirestoreSqlPlan,
  runtime: FirestoreSqlRuntime | InMemoryFirestoreSqlRuntime,
  options: FirestoreSqlExecutionOptions = {},
): AsyncIterable<ExecutionEvent> {
  const stats = createStats(options.readBudget ?? DEFAULT_READ_BUDGET);
  const startedAt = Date.now();
  const normalizedRuntime = normalizeRuntime(runtime);

  yield { kind: 'started', planKind: plan.kind };
  yield { kind: 'plan', plan };

  const unsupported = unsupportedDiagnostic(plan);
  if (unsupported) {
    yield { diagnostic: unsupported, kind: 'diagnostic' };
    yield { diagnostic: unsupported, kind: 'failed' };
    return;
  }

  try {
    if (plan.kind === 'select') {
      yield* executeSelect(plan.stages, normalizedRuntime, stats, options, startedAt);
      return;
    }

    if (plan.kind === 'unionAll') {
      yield* executeUnion(plan.stages, normalizedRuntime, stats, options, startedAt);
      return;
    }

    const unsupportedReadDiagnostic = diagnostic(
      'UNSUPPORTED_READ_COMMAND',
      `${plan.kind} is not supported by the read-only SQL executor.`,
    );
    yield { diagnostic: unsupportedReadDiagnostic, kind: 'diagnostic' };
    yield { diagnostic: unsupportedReadDiagnostic, kind: 'failed' };
  } catch (error) {
    const failure = diagnostic(
      'EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Execution failed.',
    );
    yield { diagnostic: failure, kind: 'failed' };
  }
}

async function* executeUnion(
  stages: readonly PlanStage[],
  runtime: FirestoreSqlRuntime,
  stats: MutableExecutionStats,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): AsyncIterable<ExecutionEvent> {
  const branches = stages.filter((stage): stage is UnionBranchPlanStage =>
    stage.kind === 'unionBranch'
  );
  const outputRows: Array<
    { readonly row: Record<string, unknown>; readonly lineage: FirestoreSqlRowLineage; }
  > = [];

  for (const branch of branches) {
    const controls = controlsFor(branch.stages, options, stats);
    const run = await runSelectRows(branch.stages, runtime, stats, controls, options, startedAt);
    for (const event of run.readEvents) yield event;

    const project = projectStage(branch.stages);
    const projected = project
      ? projectRows(limitedSortedRows(run.rows, project, controls), project, branch.branchIndex)
      : [];
    outputRows.push(...projected);
    yield { kind: 'stats', stats: snapshotStats(stats) };
    if (isStopped(stats)) break;
  }

  for (const item of outputRows) {
    stats.rowsOutput += 1;
    yield { kind: 'row', lineage: item.lineage, row: item.row };
  }

  yield* finishExecution(stats);
}

async function* executeSelect(
  stages: readonly PlanStage[],
  runtime: FirestoreSqlRuntime,
  stats: MutableExecutionStats,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): AsyncIterable<ExecutionEvent> {
  const controls = controlsFor(stages, options, stats);
  const run = await runSelectRows(stages, runtime, stats, controls, options, startedAt);
  for (const event of run.readEvents) yield event;

  const project = projectStage(stages);
  const outputRows = project
    ? projectRows(limitedSortedRows(run.rows, project, controls), project)
    : [];

  for (const item of outputRows) {
    stats.rowsOutput += 1;
    yield { kind: 'row', lineage: item.lineage, row: item.row };
  }

  yield { kind: 'stats', stats: snapshotStats(stats) };
  yield* finishExecution(stats);
}

async function runSelectRows(
  stages: readonly PlanStage[],
  runtime: FirestoreSqlRuntime,
  stats: MutableExecutionStats,
  controls: ExecutionControls,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): Promise<SelectRun> {
  let rows: readonly WorkingRow[] = [];
  const readEvents: ReadExecutionEvent[] = [];
  const readOptions = sourceReadOptionsFor(stages, controls.limit);

  for (const stage of stages) {
    if (shouldStop(stats, options, startedAt)) break;
    switch (stage.kind) {
      case 'execution':
        break;
      case 'read': {
        const read = await readSource(
          stage,
          undefined,
          runtime,
          stats,
          controls,
          readOptionsForSource(stage.source, readOptions),
          options,
          startedAt,
        );
        rows = read.rows;
        readEvents.push(read.event);
        break;
      }
      case 'join': {
        rows = await joinRows(
          rows,
          stage,
          runtime,
          stats,
          controls,
          readEvents,
          readOptions,
          options,
          startedAt,
        );
        break;
      }
      case 'filter':
        rows = rows.filter((row) => truthy(evaluateExpression(stage.expression, row)));
        break;
      case 'project':
      case 'aggregate':
      case 'unionBranch':
      case 'write':
        break;
    }
  }

  return { readEvents, rows };
}

async function joinRows(
  leftRows: readonly WorkingRow[],
  stage: JoinPlanStage,
  runtime: FirestoreSqlRuntime,
  stats: MutableExecutionStats,
  controls: ExecutionControls,
  readEvents: ReadExecutionEvent[],
  readOptions: ReadonlyMap<string, SourceReadOptions>,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): Promise<readonly WorkingRow[]> {
  if (stage.source.classification === 'local') {
    return joinLocalRows(
      leftRows,
      stage,
      runtime,
      stats,
      controls,
      readEvents,
      readOptions,
      options,
      startedAt,
    );
  }

  const read = await readSource(
    { kind: 'read', source: stage.source },
    undefined,
    runtime,
    stats,
    controls,
    readOptionsForSource(stage.source, readOptions),
    options,
    startedAt,
  );
  readEvents.push(read.event);
  return joinMaterializedRows(leftRows, read.rows, stage, stats);
}

async function joinLocalRows(
  leftRows: readonly WorkingRow[],
  stage: JoinPlanStage,
  runtime: FirestoreSqlRuntime,
  stats: MutableExecutionStats,
  controls: ExecutionControls,
  readEvents: ReadExecutionEvent[],
  readOptions: ReadonlyMap<string, SourceReadOptions>,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): Promise<readonly WorkingRow[]> {
  const joined: WorkingRow[] = [];
  const alias = sourceAlias(stage.source);

  for (const left of leftRows) {
    if (shouldStop(stats, options, startedAt)) break;
    const read = await readSource(
      { kind: 'read', source: stage.source },
      left,
      runtime,
      stats,
      controls,
      readOptionsForSource(stage.source, readOptions),
      options,
      startedAt,
    );
    readEvents.push(read.event);

    let matches = 0;
    for (const right of read.rows) {
      const row = mergeRows(left, right, alias, 'local');
      if (
        stage.type !== 'cross'
        && stage.condition
        && !truthy(evaluateExpression(stage.condition, row))
      ) {
        continue;
      }
      matches += 1;
      joined.push(row);
    }

    if (matches === 0 && stage.type === 'left') {
      stats.joinMisses += 1;
      joined.push({
        context: { ...left.context, [alias]: undefined },
        lineage: appendLineage(left.lineage, alias, 'local'),
        primary: left.primary,
      });
    }
  }

  return joined;
}

function joinMaterializedRows(
  leftRows: readonly WorkingRow[],
  rightRows: readonly WorkingRow[],
  stage: JoinPlanStage,
  stats: MutableExecutionStats,
): readonly WorkingRow[] {
  const joined: WorkingRow[] = [];
  const alias = sourceAlias(stage.source);

  for (const left of leftRows) {
    let matches = 0;
    for (const right of rightRows) {
      const row = mergeRows(left, right, alias, 'join');
      if (
        stage.type !== 'cross'
        && stage.condition
        && !truthy(evaluateExpression(stage.condition, row))
      ) {
        continue;
      }
      matches += 1;
      joined.push(row);
    }

    if (matches === 0 && stage.type === 'left') {
      stats.joinMisses += 1;
      joined.push({
        context: { ...left.context, [alias]: undefined },
        lineage: appendLineage(left.lineage, alias, 'join'),
        primary: left.primary,
      });
    }
  }

  return joined;
}

async function readSource(
  stage: ReadPlanStage,
  parent: WorkingRow | undefined,
  runtime: FirestoreSqlRuntime,
  stats: MutableExecutionStats,
  controls: ExecutionControls,
  readOptions: SourceReadOptions,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): Promise<{ readonly event: ReadExecutionEvent; readonly rows: readonly WorkingRow[]; }> {
  const alias = sourceAlias(stage.source);
  const values = await valuesForSource(
    stage.source,
    parent,
    runtime,
    stats,
    controls,
    readOptions,
    options,
    startedAt,
  );
  return {
    event: readEvent(stage.source, values.length),
    rows: values.map((value) => ({
      context: { [alias]: value },
      lineage: {
        baseSource: alias,
        joinedSources: [],
        localSources: stage.source.classification === 'local' ? [alias] : [],
        readContribution: value.kind === 'document' ? 1 : 0,
      },
      primary: value,
    })),
  };
}

async function valuesForSource(
  source: SourcePlan,
  parent: WorkingRow | undefined,
  runtime: FirestoreSqlRuntime,
  stats: MutableExecutionStats,
  controls: ExecutionControls,
  readOptions: SourceReadOptions,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): Promise<readonly RuntimeSourceValue[]> {
  const sourceName = sourceNameFor(source);
  if (source.sourceKind === 'function' && sourceName === 'unnest') {
    return unnestValues(evaluateExpression(source.args?.[0], requiredParent(parent)));
  }
  if (source.sourceKind === 'function' && sourceName === 'entries') {
    return entryValues(evaluateExpression(source.args?.[0], requiredParent(parent)));
  }
  if (source.sourceKind === 'function' && sourceName === 'subcollections') {
    const parentDoc = documentForValue(
      evaluateExpression(source.args?.[0], requiredParent(parent)),
    );
    if (!parentDoc) return [];
    return (await runtime.listSubcollections(parentDoc)).map((collection) => ({
      data: { id: collection.id, parentPath: collection.parentPath, path: collection.path },
      id: collection.id,
      kind: 'subcollection' as const,
      parentPath: collection.parentPath,
      path: collection.path,
      projectId: collection.projectId,
    }));
  }
  if (source.sourceKind === 'function' && sourceName === 'subcollection') {
    const parentDoc = documentForValue(
      evaluateExpression(source.args?.[0], requiredParent(parent)),
    );
    const nameValue = evaluateExpression(source.args?.[1], requiredParent(parent));
    const name = typeof nameValue === 'string' ? nameValue : undefined;
    if (!parentDoc || !name) return [];
    return collectRuntimeDocs(
      runtime.readSubcollection({
        ...readOptions,
        name,
        pageSize: controls.pageSize,
        parent: parentDoc,
      }),
      stats,
      controls,
      readOptions.limit,
      options,
      startedAt,
    );
  }
  if (source.collectionGroup) {
    return collectRuntimeDocs(
      runtime.readCollectionGroup({
        collectionGroup: source.collectionGroup,
        ...readOptions,
        pageSize: controls.pageSize,
        projectId: source.projectId,
      }),
      stats,
      controls,
      readOptions.limit,
      options,
      startedAt,
    );
  }
  if (source.collectionPath) {
    return collectRuntimeDocs(
      runtime.readCollection({
        collectionPath: source.collectionPath,
        ...readOptions,
        pageSize: controls.pageSize,
        projectId: source.projectId,
      }),
      stats,
      controls,
      readOptions.limit,
      options,
      startedAt,
    );
  }
  return [];
}

async function collectRuntimeDocs(
  iterable: AsyncIterable<FirestoreSqlRuntimeDocument>,
  stats: MutableExecutionStats,
  controls: ExecutionControls,
  readLimit: number | undefined,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): Promise<readonly RuntimeDocumentValue[]> {
  const docs: RuntimeDocumentValue[] = [];
  for await (const doc of iterable) {
    if (shouldStop(stats, options, startedAt)) break;
    incrementReads(stats, doc.projectId, controls.readBudget);
    docs.push({
      ...doc,
      kind: 'document',
      path: doc.path ?? `${doc.collectionPath}/${doc.id}`,
    });
    if (readLimit !== undefined && docs.length >= readLimit) break;
  }
  return docs;
}

function unnestValues(value: unknown): readonly RuntimeScalarValue[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => ({
    data: isRecord(item) ? item : { value: item },
    id: String(index),
    kind: 'scalar',
    value: item,
  }));
}

function entryValues(value: unknown): readonly RuntimeEntryValue[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, entry]) => ({
    data: isRecord(entry) ? entry : { value: entry },
    id: key,
    kind: 'entry',
    value: entry,
  }));
}

function projectRows(
  rows: readonly WorkingRow[],
  stage: ProjectPlanStage,
  unionBranch?: number,
): readonly { readonly lineage: FirestoreSqlRowLineage; readonly row: Record<string, unknown>; }[] {
  return rows.map((row) => ({
    lineage: unionBranch === undefined ? row.lineage : { ...row.lineage, unionBranch },
    row: projectRow(stage, row),
  }));
}

function projectRow(stage: ProjectPlanStage, row: WorkingRow): Record<string, unknown> {
  if (stage.columns.length === 1 && stage.columns[0]?.expression.kind === 'wildcard') {
    return { ...wildcardData(stage.columns[0].expression, row) };
  }

  const output: Record<string, unknown> = {};
  for (const [index, column] of stage.columns.entries()) {
    if (column.expression.kind === 'wildcard') {
      Object.assign(output, wildcardData(column.expression, row));
      continue;
    }
    output[columnName(column, index)] = evaluateExpression(column.expression, row);
  }
  return output;
}

function wildcardData(
  expression: FirestoreSqlExpression & { readonly kind: 'wildcard'; },
  row: WorkingRow,
): Record<string, unknown> {
  const qualifier = expression.qualifier?.map((part) => part.text) ?? [];
  if (qualifier.length === 0) return row.primary?.data ?? {};

  const [alias, ...path] = qualifier;
  if (alias && alias in row.context) {
    const source = row.context[alias];
    if (!source) return {};
    const value = path.length === 0 ? source.data : getNested(source.data, path);
    return isRecord(value) ? value : {};
  }

  const value = row.primary ? getNested(row.primary.data, qualifier) : undefined;
  return isRecord(value) ? value : {};
}

function sortRows(rows: readonly WorkingRow[], stage: ProjectPlanStage): readonly WorkingRow[] {
  if (!stage.orderBy?.length) return rows;
  const sorted: WorkingRow[] = [];
  for (const row of rows) {
    const insertAt = sorted.findIndex((item) => compareRows(row, item, stage) < 0);
    if (insertAt < 0) sorted.push(row);
    else sorted.splice(insertAt, 0, row);
  }
  return sorted;
}

function compareRows(
  left: WorkingRow,
  right: WorkingRow,
  stage: ProjectPlanStage,
): number {
  for (const item of stage.orderBy ?? []) {
    const direction = item.direction === 'desc' ? -1 : 1;
    const compared = compareValues(
      evaluateExpression(item.expression, left),
      evaluateExpression(item.expression, right),
    );
    if (compared !== 0) return compared * direction;
  }
  return 0;
}

function limitedSortedRows(
  rows: readonly WorkingRow[],
  stage: ProjectPlanStage,
  controls: ExecutionControls,
): readonly WorkingRow[] {
  return applyLimit(sortRows(rows, stage), controls.limit);
}

function evaluateExpression(
  expression: FirestoreSqlExpression | undefined,
  row: WorkingRow,
): unknown {
  if (!expression) return undefined;
  switch (expression.kind) {
    case 'array':
    case 'tuple':
      return expression.items.map((item) => evaluateExpression(item, row));
    case 'binary':
      return evaluateBinary(expression.operator, expression.left, expression.right, row);
    case 'call':
      return evaluateCall(expression.name, expression.args, row);
    case 'case': {
      for (const branch of expression.cases) {
        if (truthy(evaluateExpression(branch.when, row))) {
          return evaluateExpression(branch.result, row);
        }
      }
      return expression.else ? evaluateExpression(expression.else, row) : undefined;
    }
    case 'existsSubquery':
      return false;
    case 'fieldPath':
      return evaluateFieldPath(expression.parts, row);
    case 'literal':
      return expression.value;
    case 'parameter':
      return undefined;
    case 'unary': {
      const value = evaluateExpression(expression.expression, row);
      if (expression.operator === 'not') return !truthy(value);
      if (expression.operator === '-') return -Number(value);
      return undefined;
    }
    case 'wildcard':
      return wildcardData(expression, row);
  }
}

function evaluateBinary(
  operator: string,
  leftExpression: FirestoreSqlExpression,
  rightExpression: FirestoreSqlExpression,
  row: WorkingRow,
): unknown {
  if (operator === 'and') {
    return truthy(evaluateExpression(leftExpression, row))
      && truthy(evaluateExpression(rightExpression, row));
  }
  if (operator === 'or') {
    return truthy(evaluateExpression(leftExpression, row))
      || truthy(evaluateExpression(rightExpression, row));
  }

  const left = evaluateExpression(leftExpression, row);
  const right = evaluateExpression(rightExpression, row);

  switch (operator) {
    case '!=':
      return !sameValue(left, right);
    case '*':
      return Number(left) * Number(right);
    case '+':
      return Number(left) + Number(right);
    case '-':
      return Number(left) - Number(right);
    case '/':
      return Number(left) / Number(right);
    case '<':
      return comparable(left) < comparable(right);
    case '<=':
      return comparable(left) <= comparable(right);
    case '=':
      return sameValue(left, right);
    case '>':
      return comparable(left) > comparable(right);
    case '>=':
      return comparable(left) >= comparable(right);
    case 'in':
      return Array.isArray(right) && right.some((item) => sameValue(item, left));
    case 'is':
      return right === null ? left === null || left === undefined : sameValue(left, right);
    case 'is not':
      return right === null ? left !== null && left !== undefined : !sameValue(left, right);
    case 'not in':
      return Array.isArray(right) && !right.some((item) => sameValue(item, left));
    default:
      return undefined;
  }
}

function evaluateCall(
  name: string,
  args: readonly FirestoreSqlExpression[],
  row: WorkingRow,
): unknown {
  const normalizedName = name.toLowerCase();
  if (normalizedName === 'array_contains') {
    const haystack = evaluateExpression(args[0], row);
    const needle = evaluateExpression(args[1], row);
    return Array.isArray(haystack) && haystack.some((item) => sameValue(item, needle));
  }
  if (normalizedName === 'array_contains_any') {
    const haystack = evaluateExpression(args[0], row);
    const needles = evaluateExpression(args[1], row);
    return Array.isArray(haystack)
      && Array.isArray(needles)
      && needles.some((needle) => haystack.some((item) => sameValue(item, needle)));
  }
  if (normalizedName === 'coalesce') {
    return args.map((arg) => evaluateExpression(arg, row)).find((value) =>
      value !== null && value !== undefined
    );
  }
  if (normalizedName === 'concat') {
    return args.map((arg) => String(evaluateExpression(arg, row) ?? '')).join('');
  }
  if (normalizedName === 'exists') return evaluateExpression(args[0], row) !== undefined;
  if (normalizedName === 'field_path') {
    return args.map((arg) => evaluateExpression(arg, row)).join('.');
  }
  if (normalizedName === 'id' || normalizedName === 'key') {
    return sourceValueForArg(args[0], row)?.id;
  }
  if (normalizedName === 'int') return Math.trunc(Number(evaluateExpression(args[0], row)));
  if (normalizedName === 'double') return Number(evaluateExpression(args[0], row));
  if (normalizedName === 'lower') {
    return String(evaluateExpression(args[0], row) ?? '').toLowerCase();
  }
  if (normalizedName === 'missing') return evaluateExpression(args[0], row) === undefined;
  if (normalizedName === 'now') return new Date().toISOString();
  if (normalizedName === 'parent_path') return parentPath(sourceValueForArg(args[0], row));
  if (normalizedName === 'parent_ref') return parentPath(sourceValueForArg(args[0], row));
  if (normalizedName === 'path' || normalizedName === 'ref') {
    return sourceValuePath(sourceValueForArg(args[0], row));
  }
  if (normalizedName === 'project_id') return sourceValueProjectId(sourceValueForArg(args[0], row));
  if (normalizedName === 'round') return Math.round(Number(evaluateExpression(args[0], row)));
  if (normalizedName === 'upper') {
    return String(evaluateExpression(args[0], row) ?? '').toUpperCase();
  }
  if (normalizedName === 'value') return sourceValueRaw(sourceValueForArg(args[0], row));
  return undefined;
}

function evaluateFieldPath(parts: readonly FieldSegment[], row: WorkingRow): unknown {
  const first = parts[0]?.text;
  if (!first) return undefined;

  if (first in row.context) {
    const source = row.context[first];
    if (!source) return undefined;
    if (parts.length === 1) return source;
    return getNested(source.data, parts.slice(1).map((part) => part.text));
  }

  return row.primary ? getNested(row.primary.data, parts.map((part) => part.text)) : undefined;
}

function mergeRows(
  left: WorkingRow,
  right: WorkingRow,
  alias: string,
  kind: 'join' | 'local',
): WorkingRow {
  const rightValue = right.context[alias] ?? right.primary;
  return {
    context: { ...left.context, [alias]: rightValue },
    lineage: {
      ...appendLineage(left.lineage, alias, kind),
      readContribution: left.lineage.readContribution + right.lineage.readContribution,
    },
    primary: left.primary,
  };
}

function appendLineage(
  lineage: FirestoreSqlRowLineage,
  alias: string,
  kind: 'join' | 'local',
): FirestoreSqlRowLineage {
  return kind === 'join'
    ? { ...lineage, joinedSources: [...lineage.joinedSources, alias] }
    : { ...lineage, localSources: [...lineage.localSources, alias] };
}

function normalizeRuntime(
  runtime: FirestoreSqlRuntime | InMemoryFirestoreSqlRuntime,
): FirestoreSqlRuntime {
  if ('readCollection' in runtime) return runtime;
  return new InMemoryFirestoreSqlRuntimeAdapter(runtime.projects);
}

export class InMemoryFirestoreSqlRuntimeAdapter implements FirestoreSqlRuntime {
  constructor(private readonly projects: FirestoreSqlRuntimeProjects) {}

  async *readCollection(
    request: FirestoreSqlReadRequest & {
      readonly collectionPath: string;
    },
  ): AsyncIterable<FirestoreSqlRuntimeDocument> {
    const documents = this.projects[request.projectId]?.[request.collectionPath] ?? {};
    for (const [id, data] of limitedEntries(documents, request.limit)) {
      yield {
        collectionPath: request.collectionPath,
        data: projectRuntimeData(data, request.select),
        id,
        path: `${request.collectionPath}/${id}`,
        projectId: request.projectId,
      };
    }
  }

  async *readCollectionGroup(
    request: FirestoreSqlReadRequest & {
      readonly collectionGroup: string;
    },
  ): AsyncIterable<FirestoreSqlRuntimeDocument> {
    const project = this.projects[request.projectId] ?? {};
    let yielded = 0;
    for (const [collectionPath, documents] of Object.entries(project)) {
      if (lastPathSegment(collectionPath) !== request.collectionGroup) continue;
      for (const [id, data] of Object.entries(documents)) {
        yield {
          collectionPath,
          data: projectRuntimeData(data, request.select),
          id,
          path: `${collectionPath}/${id}`,
          projectId: request.projectId,
        };
        yielded += 1;
        if (request.limit !== undefined && yielded >= request.limit) return;
      }
    }
  }

  async *readSubcollection(request: FirestoreSqlSubcollectionRequest): AsyncIterable<
    FirestoreSqlRuntimeDocument
  > {
    const collectionPath = `${documentPath(request.parent)}/${request.name}`;
    const documents = this.projects[request.parent.projectId]?.[collectionPath] ?? {};
    for (const [id, data] of limitedEntries(documents, request.limit)) {
      yield {
        collectionPath,
        data: projectRuntimeData(data, request.select),
        id,
        path: `${collectionPath}/${id}`,
        projectId: request.parent.projectId,
      };
    }
  }

  async listSubcollections(
    parent: FirestoreSqlRuntimeDocument,
  ): Promise<ReadonlyArray<FirestoreSqlRuntimeCollection>> {
    const prefix = `${documentPath(parent)}/`;
    const project = this.projects[parent.projectId] ?? {};
    return Object.keys(project)
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length).split('/')[0])
      .filter((id): id is string => Boolean(id))
      .filter((id, index, all) => all.indexOf(id) === index)
      .map((id) => ({
        id,
        parentPath: documentPath(parent),
        path: `${prefix}${id}`,
        projectId: parent.projectId,
      }));
  }
}

function limitedEntries(
  documents: Record<string, FirestoreSqlDocumentData>,
  limit: number | undefined,
): ReadonlyArray<[string, FirestoreSqlDocumentData]> {
  return limit === undefined
    ? Object.entries(documents)
    : Object.entries(documents).slice(0, limit);
}

function projectRuntimeData(
  data: FirestoreSqlDocumentData,
  select: readonly FirestoreSqlSelectField[] | undefined,
): FirestoreSqlDocumentData {
  if (select === undefined) return data;

  const projected: FirestoreSqlDocumentData = {};
  for (const field of select) {
    const value = getNested(data, field.segments);
    if (value !== undefined) setNested(projected, field.segments, value);
  }
  return projected;
}

async function* finishExecution(stats: MutableExecutionStats): AsyncIterable<ExecutionEvent> {
  const snapshot = snapshotStats(stats);
  if (stats.stoppedReason === 'cancelled') {
    yield { kind: 'cancelled', stats: snapshot };
    return;
  }
  yield {
    kind: 'completed',
    stats: snapshot,
    ...(stats.stoppedReason && stats.stoppedReason !== 'completed'
      ? { stoppedReason: stats.stoppedReason }
      : {}),
  };
}

function controlsFor(
  stages: readonly PlanStage[],
  options: FirestoreSqlExecutionOptions,
  stats: MutableExecutionStats,
): ExecutionControls {
  const execution = stages.find((stage) => stage.kind === 'execution')?.execution ?? {};
  const readBudget = options.readBudget ?? execution.readBudget ?? stats.readBudget;
  stats.readBudget = readBudget;
  return {
    ...(execution.limit === undefined ? {} : { limit: execution.limit }),
    pageSize: execution.pageSize ?? DEFAULT_PAGE_SIZE,
    readBudget,
    timeoutMs: options.timeoutMs ?? execution.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function projectStage(stages: readonly PlanStage[]): ProjectPlanStage | undefined {
  return stages.find((stage) => stage.kind === 'project') as ProjectPlanStage | undefined;
}

function sourceReadOptionsFor(
  stages: readonly PlanStage[],
  limit: number | undefined,
): ReadonlyMap<string, SourceReadOptions> {
  const projection = sourceProjectionStateFor(stages);
  const baseLimit = sourceReadLimitFor(stages, limit);
  const options = new Map<string, SourceReadOptions>();

  for (const alias of projection.aliases) {
    if (projection.disabled.has(alias)) {
      if (alias === projection.primaryAlias && baseLimit !== undefined) {
        options.set(alias, { limit: baseLimit });
      }
      continue;
    }

    const select = [...(projection.fields.get(alias)?.values() ?? [])];
    options.set(alias, {
      ...(alias === projection.primaryAlias && baseLimit !== undefined ? { limit: baseLimit } : {}),
      select,
    });
  }

  return options;
}

function sourceProjectionStateFor(stages: readonly PlanStage[]): SourceProjectionState {
  const aliases = new Set<string>();
  const primary = stages.find((stage): stage is ReadPlanStage => stage.kind === 'read');
  const primaryAlias = primary ? sourceAlias(primary.source) : undefined;
  if (primaryAlias) aliases.add(primaryAlias);

  for (const stage of stages) {
    if (stage.kind === 'join') aliases.add(sourceAlias(stage.source));
  }

  const state: SourceProjectionState = {
    aliases,
    disabled: new Set(),
    fields: new Map(),
    ...(primaryAlias ? { primaryAlias } : {}),
  };

  for (const stage of stages) {
    switch (stage.kind) {
      case 'read':
        collectProjectionExpressions(stage.source.args ?? [], state);
        break;
      case 'join':
        collectProjectionExpressions(stage.source.args ?? [], state);
        if (stage.condition) collectProjectionExpression(stage.condition, state);
        break;
      case 'filter':
        collectProjectionExpression(stage.expression, state);
        break;
      case 'project':
        collectProjectionExpressions(stage.columns.map((column) => column.expression), state);
        collectProjectionExpressions(stage.orderBy?.map((item) => item.expression) ?? [], state);
        break;
      case 'aggregate':
      case 'execution':
      case 'unionBranch':
      case 'write':
        break;
    }
  }

  return state;
}

function readOptionsForSource(
  source: SourcePlan,
  options: ReadonlyMap<string, SourceReadOptions>,
): SourceReadOptions {
  return options.get(sourceAlias(source)) ?? {};
}

function sourceReadLimitFor(
  stages: readonly PlanStage[],
  limit: number | undefined,
): number | undefined {
  if (limit === undefined) return undefined;
  const project = projectStage(stages);
  if (project?.orderBy?.length) return undefined;
  return stages.some((stage) => stage.kind === 'filter' || stage.kind === 'join')
    ? undefined
    : limit;
}

function collectProjectionExpressions(
  expressions: readonly FirestoreSqlExpression[],
  state: SourceProjectionState,
): void {
  for (const expression of expressions) collectProjectionExpression(expression, state);
}

function collectProjectionExpression(
  expression: FirestoreSqlExpression,
  state: SourceProjectionState,
): void {
  switch (expression.kind) {
    case 'array':
    case 'tuple':
      collectProjectionExpressions(expression.items, state);
      return;
    case 'binary':
      collectProjectionExpression(expression.left, state);
      collectProjectionExpression(expression.right, state);
      return;
    case 'call':
      collectCallProjection(expression.name, expression.args, state);
      return;
    case 'case':
      for (const branch of expression.cases) {
        collectProjectionExpression(branch.when, state);
        collectProjectionExpression(branch.result, state);
      }
      if (expression.else) collectProjectionExpression(expression.else, state);
      return;
    case 'fieldPath':
      collectFieldPathProjection(expression.parts, state);
      return;
    case 'unary':
      collectProjectionExpression(expression.expression, state);
      return;
    case 'wildcard':
      collectWildcardProjection(expression.qualifier ?? [], state);
      return;
    case 'existsSubquery':
    case 'literal':
    case 'parameter':
      return;
  }
}

function collectCallProjection(
  name: string,
  args: readonly FirestoreSqlExpression[],
  state: SourceProjectionState,
): void {
  const normalizedName = name.toLowerCase();
  if (normalizedName === 'value') {
    disableAliasForSourceArgument(args[0], state);
    return;
  }
  if (
    ['id', 'key', 'parent_path', 'parent_ref', 'path', 'project_id', 'ref'].includes(
      normalizedName,
    )
  ) {
    for (const arg of args.slice(1)) collectProjectionExpression(arg, state);
    return;
  }
  collectProjectionExpressions(args, state);
}

function collectFieldPathProjection(
  parts: readonly FieldSegment[],
  state: SourceProjectionState,
): void {
  const first = parts[0]?.text;
  if (!first) return;

  if (state.aliases.has(first)) {
    addProjectionField(state, first, parts.slice(1).map((part) => part.text));
    return;
  }

  if (state.primaryAlias) {
    addProjectionField(state, state.primaryAlias, parts.map((part) => part.text));
  }
}

function collectWildcardProjection(
  qualifier: readonly FieldSegment[],
  state: SourceProjectionState,
): void {
  if (qualifier.length === 0) {
    if (state.primaryAlias) state.disabled.add(state.primaryAlias);
    return;
  }

  const [first, ...path] = qualifier.map((part) => part.text);
  if (first && state.aliases.has(first)) {
    addProjectionField(state, first, path);
    return;
  }

  if (first && state.primaryAlias) addProjectionField(state, state.primaryAlias, [first, ...path]);
}

function disableAliasForSourceArgument(
  expression: FirestoreSqlExpression | undefined,
  state: SourceProjectionState,
): void {
  if (expression?.kind !== 'fieldPath') return;
  const alias = expression.parts[0]?.text;
  if (alias && state.aliases.has(alias) && expression.parts.length === 1) {
    state.disabled.add(alias);
  } else {
    collectProjectionExpression(expression, state);
  }
}

function addProjectionField(
  state: SourceProjectionState,
  alias: string,
  segments: readonly string[],
): void {
  if (segments.length === 0) {
    state.disabled.add(alias);
    return;
  }
  if (state.disabled.has(alias)) return;

  const existing = state.fields.get(alias) ?? new Map<string, FirestoreSqlSelectField>();
  if ([...existing.values()].some((field) => isPathPrefix(field.segments, segments))) return;

  for (const [key, field] of existing) {
    if (isPathPrefix(segments, field.segments)) existing.delete(key);
  }

  existing.set(fieldKey(segments), { segments });
  state.fields.set(alias, existing);
}

function isPathPrefix(left: readonly string[], right: readonly string[]): boolean {
  return left.length <= right.length && left.every((segment, index) => segment === right[index]);
}

function fieldKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

function unsupportedDiagnostic(plan: FirestoreSqlPlan): AnalysisDiagnostic | undefined {
  if (plan.kind !== 'select' && plan.kind !== 'unionAll') {
    return diagnostic(
      'UNSUPPORTED_READ_COMMAND',
      `${plan.kind} is not supported by the read-only SQL executor.`,
    );
  }
  for (const stage of flattenStages(plan.stages)) {
    if (stage.kind === 'aggregate') {
      return diagnostic(
        'UNSUPPORTED_AGGREGATION',
        'Aggregation is not supported in this read release.',
      );
    }
    if (stage.kind === 'write') {
      return diagnostic(
        'UNSUPPORTED_READ_COMMAND',
        'Writes are not supported by the read-only SQL executor.',
      );
    }
  }
  return undefined;
}

function flattenStages(stages: readonly PlanStage[]): readonly PlanStage[] {
  return stages.flatMap((stage) =>
    stage.kind === 'unionBranch' ? [stage, ...flattenStages(stage.stages)] : [stage]
  );
}

function readEvent(source: SourcePlan, count: number): ReadExecutionEvent {
  return {
    ...(source.collectionGroup ? { collectionGroup: source.collectionGroup } : {}),
    ...(source.collectionPath ? { collectionPath: source.collectionPath } : {}),
    count,
    kind: 'read',
    projectId: source.projectId,
  };
}

function sourceAlias(source: SourcePlan): string {
  return source.alias ?? source.collectionPath ?? source.collectionGroup ?? sourceNameFor(source);
}

function sourceNameFor(source: SourcePlan): string {
  if (source.sourceKind === 'function') {
    return (source.functionName ?? source.alias ?? 'source').toLowerCase();
  }
  return source.collectionPath ?? source.alias ?? 'source';
}

function columnName(column: SelectColumn, index: number): string {
  if (column.alias) return column.alias;
  if (column.expression.kind === 'fieldPath') {
    return column.expression.parts.at(-1)?.text ?? `column${index + 1}`;
  }
  if (column.expression.kind === 'call') return column.expression.name.toLowerCase();
  return `column${index + 1}`;
}

function applyLimit<T>(items: readonly T[], limit: number | undefined): readonly T[] {
  return limit === undefined ? items : items.slice(0, limit);
}

function incrementReads(
  stats: MutableExecutionStats,
  projectId: string,
  readBudget: number,
): void {
  stats.reads += 1;
  stats.rowsScanned += 1;
  stats.perProjectReads[projectId] = (stats.perProjectReads[projectId] ?? 0) + 1;
  if (stats.reads >= readBudget) stats.stoppedReason = 'budget';
}

function shouldStop(
  stats: MutableExecutionStats,
  options: FirestoreSqlExecutionOptions,
  startedAt: number,
): boolean {
  if (stats.stoppedReason) return true;
  if (options.signal?.aborted) {
    stats.stoppedReason = 'cancelled';
    return true;
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (Date.now() - startedAt > timeoutMs) {
    stats.stoppedReason = 'timeout';
    return true;
  }
  return false;
}

function isStopped(stats: MutableExecutionStats): boolean {
  return Boolean(stats.stoppedReason);
}

function snapshotStats(stats: MutableExecutionStats): ExecutionStats {
  return {
    joinMisses: stats.joinMisses,
    perProjectReads: { ...stats.perProjectReads },
    readBudget: stats.readBudget,
    reads: stats.reads,
    rowsOutput: stats.rowsOutput,
    rowsScanned: stats.rowsScanned,
    ...(stats.stoppedReason ? { stoppedReason: stats.stoppedReason } : {}),
    writes: stats.writes,
  };
}

function createStats(readBudget: number): MutableExecutionStats {
  return {
    joinMisses: 0,
    perProjectReads: {},
    readBudget,
    reads: 0,
    rowsOutput: 0,
    rowsScanned: 0,
    writes: 0,
  };
}

function diagnostic(code: string, message: string): AnalysisDiagnostic {
  return { code, message, severity: 'error' };
}

function sourceValueForArg(
  arg: FirestoreSqlExpression | undefined,
  row: WorkingRow,
): RuntimeSourceValue | undefined {
  if (!arg || arg.kind !== 'fieldPath' || arg.parts.length !== 1) return undefined;
  return row.context[arg.parts[0]?.text ?? ''];
}

function documentForValue(value: unknown): RuntimeDocumentValue | undefined {
  if (isRuntimeSourceValue(value) && value.kind === 'document') return value;
  return undefined;
}

function documentPath(document: FirestoreSqlRuntimeDocument): string {
  return document.path ?? `${document.collectionPath}/${document.id}`;
}

function sourceValuePath(value: RuntimeSourceValue | undefined): string | undefined {
  if (!value) return undefined;
  if (value.kind === 'document') return value.path;
  if (value.kind === 'subcollection') return value.path;
  return undefined;
}

function parentPath(value: RuntimeSourceValue | undefined): string | undefined {
  if (!value) return undefined;
  if (value.kind === 'subcollection') return value.parentPath;
  if (value.kind === 'document') return value.collectionPath.split('/').slice(0, -1).join('/');
  return undefined;
}

function sourceValueRaw(value: RuntimeSourceValue | undefined): unknown {
  if (!value) return undefined;
  if (value.kind === 'document' || value.kind === 'subcollection') return value.data;
  return value.value;
}

function sourceValueProjectId(value: RuntimeSourceValue | undefined): string | undefined {
  if (!value) return undefined;
  if (value.kind === 'document' || value.kind === 'subcollection') return value.projectId;
  return undefined;
}

function getNested(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setNested(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target;
  for (const [index, part] of path.entries()) {
    if (index === path.length - 1) {
      current[part] = value;
      return;
    }

    const existing = current[part];
    if (isRecord(existing)) {
      current = existing;
    } else {
      const next: Record<string, unknown> = {};
      current[part] = next;
      current = next;
    }
  }
}

function comparable(value: unknown): number | string {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (isRecord(value) && typeof value['isoString'] === 'string') return value['isoString'];
  return String(value);
}

function compareValues(left: unknown, right: unknown): number {
  const comparableLeft = comparable(left);
  const comparableRight = comparable(right);
  if (comparableLeft < comparableRight) return -1;
  if (comparableLeft > comparableRight) return 1;
  return 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (isRuntimeSourceValue(left)) return sameValue(sourceValueRaw(left), right);
  if (isRuntimeSourceValue(right)) return sameValue(left, sourceValueRaw(right));
  if (isRecord(left) && typeof left['path'] === 'string' && typeof right === 'string') {
    return left['path'] === right;
  }
  if (isRecord(right) && typeof right['path'] === 'string' && typeof left === 'string') {
    return right['path'] === left;
  }
  return left === right;
}

function requiredParent(row: WorkingRow | undefined): WorkingRow {
  if (!row) {
    return {
      context: {},
      lineage: { joinedSources: [], localSources: [], readContribution: 0 },
      primary: undefined,
    };
  }
  return row;
}

function lastPathSegment(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

function isRuntimeSourceValue(value: unknown): value is RuntimeSourceValue {
  return isRecord(value) && typeof value['kind'] === 'string'
    && ['document', 'entry', 'scalar', 'subcollection'].includes(value['kind']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
