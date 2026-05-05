import type { AnalysisDiagnostic } from './analyzer.ts';
import type { FieldSegment, FirestoreSqlExpression, InsertTarget, SelectColumn } from './parser.ts';
import type {
  ExecutionPlanStage,
  FirestoreSqlPlan,
  JoinPlanStage,
  PlanStage,
  ProjectPlanStage,
  ReadPlanStage,
  SourcePlan,
  WritePlanStage,
} from './planner.ts';

export type FirestoreSqlDocumentData = Record<string, unknown>;

export interface InMemoryFirestoreSqlRuntime {
  readonly projects: FirestoreSqlRuntimeProjects;
}

export type FirestoreSqlRuntimeProjects = Record<
  string,
  Record<string, Record<string, FirestoreSqlDocumentData>>
>;

export interface ExecutionStats {
  readonly joinMisses: number;
  readonly perProjectReads: Readonly<Record<string, number>>;
  readonly reads: number;
  readonly rowsOutput: number;
  readonly rowsScanned: number;
  readonly writes: number;
}

export type ExecutionEvent =
  | CompletedExecutionEvent
  | FailedExecutionEvent
  | ReadExecutionEvent
  | RowExecutionEvent
  | StartedExecutionEvent
  | StatsExecutionEvent;

export interface StartedExecutionEvent {
  readonly kind: 'started';
  readonly planKind: FirestoreSqlPlan['kind'];
}

export interface ReadExecutionEvent {
  readonly collectionGroup?: string;
  readonly collectionPath?: string;
  readonly count: number;
  readonly kind: 'read';
  readonly projectId: string;
}

export interface RowExecutionEvent {
  readonly kind: 'row';
  readonly row: Record<string, unknown>;
}

export interface StatsExecutionEvent {
  readonly kind: 'stats';
  readonly stats: ExecutionStats;
}

export interface CompletedExecutionEvent {
  readonly kind: 'completed';
  readonly stats: ExecutionStats;
}

export interface FailedExecutionEvent {
  readonly diagnostic: AnalysisDiagnostic;
  readonly kind: 'failed';
}

interface MutableExecutionStats {
  joinMisses: number;
  perProjectReads: Record<string, number>;
  reads: number;
  rowsOutput: number;
  rowsScanned: number;
  writes: number;
}

interface DocumentRef {
  readonly collectionPath: string;
  readonly data: FirestoreSqlDocumentData;
  readonly id: string;
  readonly projectId: string;
}

interface WorkingRow {
  readonly context: Record<string, DocumentRef | undefined>;
  readonly primary: DocumentRef;
}

interface RowRun {
  readonly execution: Partial<ExecutionPlanStage['execution']>;
  readonly projectedRows: readonly Record<string, unknown>[] | undefined;
  readonly readEvents: readonly ReadExecutionEvent[];
  readonly rows: readonly WorkingRow[];
}

export async function* executeFirestoreSql(
  plan: FirestoreSqlPlan,
  runtime: InMemoryFirestoreSqlRuntime,
): AsyncIterable<ExecutionEvent> {
  const stats = createStats();
  yield { kind: 'started', planKind: plan.kind };

  const unsupported = unsupportedDiagnostic(plan.stages);
  if (unsupported) {
    yield { diagnostic: unsupported, kind: 'failed' };
    return;
  }

  try {
    if (plan.kind === 'select') {
      yield* executeSelect(plan.stages, runtime, stats);
      return;
    }

    if (plan.kind === 'delete' || plan.kind === 'update' || plan.kind === 'insert') {
      yield* executeWrite(plan.stages, runtime, stats);
      return;
    }

    yield {
      diagnostic: {
        code: 'UNSUPPORTED_EXECUTION_PLAN',
        message: `${plan.kind} plans are not executable by the mock executor yet.`,
        severity: 'error',
      },
      kind: 'failed',
    };
  } catch (error) {
    yield {
      diagnostic: {
        code: 'EXECUTION_FAILED',
        message: error instanceof Error ? error.message : 'Execution failed.',
        severity: 'error',
      },
      kind: 'failed',
    };
  }
}

async function* executeSelect(
  stages: readonly PlanStage[],
  runtime: InMemoryFirestoreSqlRuntime,
  stats: MutableExecutionStats,
): AsyncIterable<ExecutionEvent> {
  const run = runRows(stages, runtime, stats);
  for (const event of run.readEvents) yield event;

  const outputRows = applyLimit(run.projectedRows ?? [], run.execution.limit);
  for (const row of outputRows) {
    stats.rowsOutput += 1;
    yield { kind: 'row', row };
  }

  yield { kind: 'stats', stats: snapshotStats(stats) };
  yield { kind: 'completed', stats: snapshotStats(stats) };
}

async function* executeWrite(
  stages: readonly PlanStage[],
  runtime: InMemoryFirestoreSqlRuntime,
  stats: MutableExecutionStats,
): AsyncIterable<ExecutionEvent> {
  const run = runRows(stages, runtime, stats);
  for (const event of run.readEvents) yield event;

  const write = stages.find((stage) => stage.kind === 'write') as WritePlanStage | undefined;
  if (!write) {
    yield {
      diagnostic: {
        code: 'MISSING_WRITE_STAGE',
        message: 'Write plans must include a write stage.',
        severity: 'error',
      },
      kind: 'failed',
    };
    return;
  }

  if (write.operation === 'delete') executeDelete(write, run.rows, runtime, stats);
  else if (write.operation === 'update') executeUpdate(write, run.rows, stats);
  else executeInsert(write, run, runtime, stats);

  yield { kind: 'stats', stats: snapshotStats(stats) };
  yield { kind: 'completed', stats: snapshotStats(stats) };
}

function runRows(
  stages: readonly PlanStage[],
  runtime: InMemoryFirestoreSqlRuntime,
  stats: MutableExecutionStats,
): RowRun {
  let rows: readonly WorkingRow[] = [];
  let projectedRows: readonly Record<string, unknown>[] | undefined;
  let execution: Partial<ExecutionPlanStage['execution']> = {};
  const readEvents: ReadExecutionEvent[] = [];

  for (const stage of stages) {
    switch (stage.kind) {
      case 'execution':
        execution = { ...execution, ...stage.execution };
        break;
      case 'read': {
        const read = readSource(stage, runtime, stats);
        rows = read.rows;
        readEvents.push(read.event);
        break;
      }
      case 'join': {
        const read = readSource({ kind: 'read', source: stage.source }, runtime, stats);
        rows = joinRows(rows, read.rows.map((row) => row.primary), stage, stats);
        readEvents.push(read.event);
        break;
      }
      case 'filter':
        rows = rows.filter((row) => truthy(evaluateExpression(stage.expression, row)));
        break;
      case 'project':
        projectedRows = rows.map((row) => projectRow(stage, row));
        break;
      case 'write':
        return { execution, projectedRows, readEvents, rows };
      case 'aggregate':
      case 'unionBranch':
        break;
    }
  }

  return { execution, projectedRows, readEvents, rows };
}

function readSource(
  stage: ReadPlanStage,
  runtime: InMemoryFirestoreSqlRuntime,
  stats: MutableExecutionStats,
): {
  readonly event: ReadExecutionEvent;
  readonly rows: readonly WorkingRow[];
} {
  const docs = documentsForSource(stage.source, runtime);
  const alias = sourceAlias(stage.source);
  for (const doc of docs) incrementReads(stats, doc.projectId);

  return {
    event: readEvent(stage.source, docs.length),
    rows: docs.map((doc) => ({
      context: { [alias]: doc },
      primary: doc,
    })),
  };
}

function documentsForSource(
  source: SourcePlan,
  runtime: InMemoryFirestoreSqlRuntime,
): readonly DocumentRef[] {
  const project = runtime.projects[source.projectId] ?? {};
  if (source.collectionGroup) {
    return Object.entries(project).flatMap(([collectionPath, documents]) => {
      if (lastPathSegment(collectionPath) !== source.collectionGroup) return [];
      return documentEntries(source.projectId, collectionPath, documents);
    });
  }

  if (!source.collectionPath) return [];
  return documentEntries(
    source.projectId,
    source.collectionPath,
    project[source.collectionPath] ?? {},
  );
}

function documentEntries(
  projectId: string,
  collectionPath: string,
  documents: Record<string, FirestoreSqlDocumentData>,
): readonly DocumentRef[] {
  return Object.entries(documents).map(([id, data]) => ({
    collectionPath,
    data,
    id,
    projectId,
  }));
}

function joinRows(
  leftRows: readonly WorkingRow[],
  rightDocs: readonly DocumentRef[],
  stage: JoinPlanStage,
  stats: MutableExecutionStats,
): readonly WorkingRow[] {
  const alias = sourceAlias(stage.source);
  const joined: WorkingRow[] = [];

  for (const left of leftRows) {
    let matches = 0;
    for (const right of rightDocs) {
      const row = {
        context: { ...left.context, [alias]: right },
        primary: left.primary,
      };
      if (
        stage.type !== 'cross' && stage.condition
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
        primary: left.primary,
      });
    }
  }

  return joined;
}

function projectRow(stage: ProjectPlanStage, row: WorkingRow): Record<string, unknown> {
  if (stage.columns.length === 1 && stage.columns[0]?.expression.kind === 'wildcard') {
    return { ...row.primary.data };
  }

  const output: Record<string, unknown> = {};
  for (const [index, column] of stage.columns.entries()) {
    output[columnName(column, index)] = evaluateExpression(column.expression, row);
  }
  return output;
}

function executeDelete(
  write: WritePlanStage,
  rows: readonly WorkingRow[],
  runtime: InMemoryFirestoreSqlRuntime,
  stats: MutableExecutionStats,
): void {
  const targetAlias = write.targetAlias ?? write.target.alias ?? sourceAlias(write.target);
  for (const row of rows) {
    const doc = row.context[targetAlias];
    if (!doc) continue;
    delete runtime.projects[doc.projectId]?.[doc.collectionPath]?.[doc.id];
    stats.writes += 1;
  }
}

function executeUpdate(
  write: WritePlanStage,
  rows: readonly WorkingRow[],
  stats: MutableExecutionStats,
): void {
  const targetAlias = write.targetAlias ?? write.target.alias ?? sourceAlias(write.target);
  for (const row of rows) {
    const doc = row.context[targetAlias];
    if (!doc) continue;
    for (const assignment of write.assignments ?? []) {
      const path = assignmentPath(assignment.target, targetAlias, row);
      setNested(doc.data, path, evaluateExpression(assignment.value, row));
    }
    stats.writes += 1;
  }
}

function executeInsert(
  write: WritePlanStage,
  run: RowRun,
  runtime: InMemoryFirestoreSqlRuntime,
  stats: MutableExecutionStats,
): void {
  const collection = collectionForWrite(write.target, runtime);

  if (write.insertValues) {
    const row = emptyWriteRow(write.target);
    insertValues(
      write.insertTargets ?? [],
      write.insertValues.map((value) => evaluateExpression(value, row)),
      collection,
      stats,
    );
    return;
  }

  for (const row of run.projectedRows ?? []) {
    insertValues(write.insertTargets ?? [], Object.values(row), collection, stats);
  }
}

function insertValues(
  targets: readonly InsertTarget[],
  values: readonly unknown[],
  collection: Record<string, FirestoreSqlDocumentData>,
  stats: MutableExecutionStats,
): void {
  const documentIdIndex = targets.findIndex((target) => target.kind === 'documentId');
  const documentId = documentIdIndex >= 0
    ? String(values[documentIdIndex] ?? generatedDocumentId(collection))
    : generatedDocumentId(collection);
  const data: FirestoreSqlDocumentData = {};

  for (const [index, target] of targets.entries()) {
    if (target.kind === 'documentId') continue;
    setNested(data, target.path.map((part) => part.text), values[index]);
  }

  collection[documentId] = data;
  stats.writes += 1;
}

function collectionForWrite(
  source: SourcePlan,
  runtime: InMemoryFirestoreSqlRuntime,
): Record<string, FirestoreSqlDocumentData> {
  const project = runtime.projects[source.projectId] ??= {};
  const collectionPath = source.collectionPath ?? source.alias ?? 'documents';
  return project[collectionPath] ??= {};
}

function emptyWriteRow(source: SourcePlan): WorkingRow {
  const collectionPath = source.collectionPath ?? source.alias ?? 'documents';
  const doc: DocumentRef = {
    collectionPath,
    data: {},
    id: '',
    projectId: source.projectId,
  };
  return {
    context: { [sourceAlias(source)]: doc },
    primary: doc,
  };
}

function evaluateExpression(expression: FirestoreSqlExpression, row: WorkingRow): unknown {
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
      return row.primary.data;
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
      return left !== right;
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
      return left === right;
    case '>':
      return comparable(left) > comparable(right);
    case '>=':
      return comparable(left) >= comparable(right);
    case 'in':
      return Array.isArray(right) && right.includes(left);
    case 'is':
      return right === null ? left === null || left === undefined : left === right;
    case 'is not':
      return right === null ? left !== null && left !== undefined : left !== right;
    case 'not in':
      return Array.isArray(right) && !right.includes(left);
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
  if (normalizedName === 'id') return documentForArg(args[0], row)?.id;
  if (normalizedName === 'path') {
    const doc = documentForArg(args[0], row);
    return doc ? `${doc.collectionPath}/${doc.id}` : undefined;
  }
  if (normalizedName === 'project_id') return documentForArg(args[0], row)?.projectId;
  if (normalizedName === 'now' || normalizedName === 'server_timestamp') {
    return new Date().toISOString();
  }
  if (normalizedName === 'field_path') {
    return args.map((arg) => evaluateExpression(arg, row)).join('.');
  }
  return undefined;
}

function documentForArg(
  arg: FirestoreSqlExpression | undefined,
  row: WorkingRow,
): DocumentRef | undefined {
  if (!arg || arg.kind !== 'fieldPath' || arg.parts.length !== 1) return undefined;
  return row.context[arg.parts[0]?.text ?? ''];
}

function evaluateFieldPath(parts: readonly FieldSegment[], row: WorkingRow): unknown {
  const first = parts[0]?.text;
  if (!first) return undefined;

  if (first in row.context) {
    const doc = row.context[first];
    return doc ? getNested(doc.data, parts.slice(1).map((part) => part.text)) : undefined;
  }

  const primaryAliases = Object.values(row.context).filter((doc) => doc === row.primary);
  if (primaryAliases.length > 0) return getNested(row.primary.data, parts.map((part) => part.text));
  return undefined;
}

function assignmentPath(
  expression: FirestoreSqlExpression,
  targetAlias: string,
  row: WorkingRow,
): readonly string[] {
  if (expression.kind === 'fieldPath') {
    const parts = expression.parts.map((part) => part.text);
    return parts[0] === targetAlias ? parts.slice(1) : parts;
  }
  if (expression.kind === 'call' && expression.name.toLowerCase() === 'field_path') {
    return expression.args.map((arg) => String(evaluateExpression(arg, row)));
  }
  return [];
}

function getNested(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setNested(
  target: FirestoreSqlDocumentData,
  path: readonly string[],
  value: unknown,
): void {
  if (path.length === 0) return;
  let current: Record<string, unknown> = target;
  for (const part of path.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const last = path.at(-1);
  if (last) current[last] = value;
}

function unsupportedDiagnostic(stages: readonly PlanStage[]): AnalysisDiagnostic | undefined {
  for (const stage of stages) {
    if (stage.kind === 'aggregate') {
      return {
        code: 'UNSUPPORTED_EXECUTION_STAGE',
        message: 'aggregate stages are not executable by the mock executor yet.',
        severity: 'error',
      };
    }
    if (stage.kind === 'unionBranch') {
      return {
        code: 'UNSUPPORTED_EXECUTION_STAGE',
        message: 'unionBranch stages are not executable by the mock executor yet.',
        severity: 'error',
      };
    }
  }
  return undefined;
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
  return source.alias ?? source.collectionPath ?? source.collectionGroup ?? 'source';
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

function incrementReads(stats: MutableExecutionStats, projectId: string): void {
  stats.reads += 1;
  stats.rowsScanned += 1;
  stats.perProjectReads[projectId] = (stats.perProjectReads[projectId] ?? 0) + 1;
}

function snapshotStats(stats: MutableExecutionStats): ExecutionStats {
  return {
    joinMisses: stats.joinMisses,
    perProjectReads: { ...stats.perProjectReads },
    reads: stats.reads,
    rowsOutput: stats.rowsOutput,
    rowsScanned: stats.rowsScanned,
    writes: stats.writes,
  };
}

function createStats(): MutableExecutionStats {
  return {
    joinMisses: 0,
    perProjectReads: {},
    reads: 0,
    rowsOutput: 0,
    rowsScanned: 0,
    writes: 0,
  };
}

function generatedDocumentId(collection: Record<string, FirestoreSqlDocumentData>): string {
  return `doc_${Object.keys(collection).length + 1}`;
}

function comparable(value: unknown): number | string {
  return typeof value === 'number' || typeof value === 'string' ? value : String(value);
}

function lastPathSegment(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
