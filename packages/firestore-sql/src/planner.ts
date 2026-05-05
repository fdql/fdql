import type {
  AnalysisDiagnostic,
  AnalysisResult,
  FirestoreSqlAnalysisContext,
} from './analyzer.ts';
import type {
  Assignment,
  DeleteStatement,
  ExecutionClauses,
  FirestoreSqlExpression,
  FirestoreSqlSource,
  FirestoreSqlStatement,
  InsertStatement,
  InsertTarget,
  JoinClause,
  ProjectSource,
  SelectColumn,
  SelectStatement,
  UnionAllStatement,
  UpdateStatement,
} from './parser.ts';

export interface FirestoreSqlPlannerOptions extends FirestoreSqlAnalysisContext {
  readonly executionDefaults?: ExecutionDefaults;
}

export interface ExecutionDefaults {
  readonly limit?: number;
  readonly pageSize?: number;
  readonly writeBatchSize?: number;
  readonly writeMode?: 'batch' | 'bulk_writer';
}

export interface PlanResult {
  readonly diagnostics: readonly AnalysisDiagnostic[];
  readonly ok: boolean;
  readonly plan?: FirestoreSqlPlan;
}

export interface FirestoreSqlPlan {
  readonly kind: FirestoreSqlStatement['kind'];
  readonly stages: readonly PlanStage[];
}

export type StageClassification = 'local' | 'native';

export type PlanStage =
  | AggregatePlanStage
  | ExecutionPlanStage
  | FilterPlanStage
  | JoinPlanStage
  | ProjectPlanStage
  | ReadPlanStage
  | UnionBranchPlanStage
  | WritePlanStage;

export interface SourcePlan {
  readonly alias?: string;
  readonly collectionGroup?: string;
  readonly collectionPath?: string;
  readonly classification: StageClassification;
  readonly projectId: string;
  readonly sourceKind: FirestoreSqlSource['kind'];
}

export interface ExecutionPlanStage {
  readonly execution: ExecutionClauses;
  readonly kind: 'execution';
}

export interface ReadPlanStage {
  readonly kind: 'read';
  readonly source: SourcePlan;
}

export interface FilterPlanStage {
  readonly classification: StageClassification;
  readonly expression: FirestoreSqlExpression;
  readonly kind: 'filter';
}

export interface JoinPlanStage {
  readonly condition?: FirestoreSqlExpression;
  readonly kind: 'join';
  readonly source: SourcePlan;
  readonly type: JoinClause['type'];
}

export interface ProjectPlanStage {
  readonly columnCount: number;
  readonly columns: readonly SelectColumn[];
  readonly computed: boolean;
  readonly kind: 'project';
}

export interface AggregatePlanStage {
  readonly groupByCount: number;
  readonly kind: 'aggregate';
  readonly metricCount: number;
}

export interface UnionBranchPlanStage {
  readonly branchIndex: number;
  readonly kind: 'unionBranch';
  readonly stages: readonly PlanStage[];
}

export interface WritePlanStage {
  readonly assignments?: readonly Assignment[];
  readonly insertTargets?: readonly InsertTarget[];
  readonly insertValues?: readonly FirestoreSqlExpression[];
  readonly kind: 'write';
  readonly operation: 'delete' | 'insert' | 'update';
  readonly target: SourcePlan;
  readonly targetAlias?: string;
  readonly writeCount?: number;
}

export function planFirestoreSql(
  ast: FirestoreSqlStatement,
  analysis: AnalysisResult,
  options: FirestoreSqlPlannerOptions,
): PlanResult {
  if (!analysis.ok) return { diagnostics: analysis.diagnostics, ok: false };

  const diagnostics: AnalysisDiagnostic[] = [...analysis.diagnostics];
  const plan = planStatement(ast, options, diagnostics);
  return {
    diagnostics,
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    plan,
  };
}

function planStatement(
  statement: FirestoreSqlStatement,
  options: FirestoreSqlPlannerOptions,
  diagnostics: AnalysisDiagnostic[],
): FirestoreSqlPlan {
  switch (statement.kind) {
    case 'delete':
      return { kind: 'delete', stages: planDelete(statement, options) };
    case 'insert':
      return { kind: 'insert', stages: planInsert(statement, options, diagnostics) };
    case 'recursiveCte':
      diagnostics.push({
        code: 'UNSUPPORTED_RECURSIVE_CTE',
        message: 'Recursive CTE planning is represented but not executable yet.',
        severity: 'warning',
      });
      return { kind: 'recursiveCte', stages: [] };
    case 'select':
      return { kind: 'select', stages: planSelect(statement, options) };
    case 'unionAll':
      return { kind: 'unionAll', stages: planUnion(statement, options) };
    case 'update':
      return { kind: 'update', stages: planUpdate(statement, options) };
    case 'describe':
    case 'discoverSchema':
    case 'script':
      diagnostics.push({
        code: 'UNSUPPORTED_PLAN_STATEMENT',
        message: `${statement.kind} planning is not executable yet.`,
        severity: 'warning',
      });
      return { kind: statement.kind, stages: [] };
  }
}

function planSelect(
  statement: SelectStatement,
  options: FirestoreSqlPlannerOptions,
): readonly PlanStage[] {
  const stages: PlanStage[] = [
    executionStage(statement.execution, options),
    { kind: 'read', source: sourcePlan(statement.from, options) },
  ];
  stages.push(...statement.joins.map((join) => joinStage(join, options)));
  if (statement.where) {
    stages.push({
      classification: classifyFilter(statement.where),
      expression: statement.where,
      kind: 'filter',
    });
  }
  if (
    statement.groupBy || statement.having
    || statement.columns.some((column) => hasAggregate(column.expression))
  ) {
    stages.push({
      groupByCount: statement.groupBy?.length ?? 0,
      kind: 'aggregate',
      metricCount: statement.columns.filter((column) => hasAggregate(column.expression)).length,
    });
  }
  stages.push({
    columnCount: statement.columns.length,
    columns: statement.columns,
    computed: statement.columns.some((column) => isComputedExpression(column.expression)),
    kind: 'project',
  });
  return stages;
}

function planUnion(
  statement: UnionAllStatement,
  options: FirestoreSqlPlannerOptions,
): readonly PlanStage[] {
  return statement.branches.map((branch, branchIndex) => ({
    branchIndex,
    kind: 'unionBranch',
    stages: planSelect(branch, options),
  }));
}

function planDelete(
  statement: DeleteStatement,
  options: FirestoreSqlPlannerOptions,
): readonly PlanStage[] {
  const stages: PlanStage[] = [
    executionStage(statement.execution, options),
    { kind: 'read', source: sourcePlan(statement.from, options) },
  ];
  stages.push(...statement.joins.map((join) => joinStage(join, options)));
  if (statement.using) {
    stages.push(joinStage({ source: statement.using.source, type: 'join' }, options));
    stages.push(...statement.using.joins.map((join) => joinStage(join, options)));
  }
  if (statement.where) {
    stages.push({
      classification: classifyFilter(statement.where),
      expression: statement.where,
      kind: 'filter',
    });
  }
  stages.push({
    kind: 'write',
    operation: 'delete',
    target: sourcePlan(statement.from, options),
    ...(statement.targetAlias ? { targetAlias: statement.targetAlias } : {}),
  });
  return stages;
}

function planUpdate(
  statement: UpdateStatement,
  options: FirestoreSqlPlannerOptions,
): readonly PlanStage[] {
  const source = statement.target.kind === 'targetAlias'
    ? statement.from?.source
    : statement.target;
  const stages: PlanStage[] = [executionStage(statement.execution, options)];
  if (source) stages.push({ kind: 'read', source: sourcePlan(source, options) });
  if (statement.from) {
    stages.push(...statement.from.joins.map((join) => joinStage(join, options)));
  }
  if (statement.where) {
    stages.push({
      classification: classifyFilter(statement.where),
      expression: statement.where,
      kind: 'filter',
    });
  }
  stages.push({
    assignments: statement.set,
    kind: 'write',
    operation: 'update',
    target: source ? sourcePlan(source, options) : defaultSourcePlan(options),
    ...(statement.target.kind === 'targetAlias' ? { targetAlias: statement.target.name } : {}),
    writeCount: statement.set.length,
  });
  return stages;
}

function planInsert(
  statement: InsertStatement,
  options: FirestoreSqlPlannerOptions,
  diagnostics: AnalysisDiagnostic[],
): readonly PlanStage[] {
  const stages: PlanStage[] = [executionStage(statement.execution, options)];
  if (statement.source) {
    stages.push(...planStatement(statement.source, options, diagnostics).stages);
  }
  const writeStage: WritePlanStage = {
    insertTargets: statement.targets,
    kind: 'write',
    operation: 'insert',
    target: sourcePlan(statement.target, options),
    ...(statement.values
      ? { insertValues: statement.values, writeCount: statement.values.length }
      : {}),
  };
  stages.push(writeStage);
  return stages;
}

function executionStage(
  statementExecution: ExecutionClauses | undefined,
  options: FirestoreSqlPlannerOptions,
): ExecutionPlanStage {
  return {
    execution: { ...options.executionDefaults, ...statementExecution },
    kind: 'execution',
  };
}

function joinStage(join: JoinClause, options: FirestoreSqlPlannerOptions): JoinPlanStage {
  const stage: JoinPlanStage = {
    kind: 'join',
    source: sourcePlan(join.source, options),
    type: join.type,
  };
  return join.condition ? { ...stage, condition: join.condition } : stage;
}

function sourcePlan(
  source: FirestoreSqlSource,
  options: FirestoreSqlPlannerOptions,
): SourcePlan {
  if (source.kind === 'project') {
    return sourcePlanForProject(source, options);
  }
  return sourcePlanFromBody(source, options.defaultProjectId);
}

function sourcePlanForProject(
  source: ProjectSource,
  options: FirestoreSqlPlannerOptions,
): SourcePlan {
  const inner = sourcePlanFromBody(source.source, projectIdForSource(source, options));
  return source.alias ? { ...inner, alias: source.alias, sourceKind: 'project' } : inner;
}

function sourcePlanFromBody(
  source: Exclude<FirestoreSqlSource, ProjectSource>,
  projectId: string,
): SourcePlan {
  if (source.kind === 'collection') {
    return {
      alias: source.alias ?? source.name,
      classification: 'native',
      collectionPath: source.name,
      projectId,
      sourceKind: 'collection',
    };
  }

  const literalArg = source.args[0]?.kind === 'literal' ? source.args[0] : undefined;
  const literal = literalArg?.valueType === 'string' ? String(literalArg.value) : undefined;
  const base: SourcePlan = {
    alias: source.alias ?? source.name,
    classification: source.name.toLowerCase() === 'collection_group' ? 'native' : 'local',
    projectId,
    sourceKind: 'function',
  };
  if (source.name.toLowerCase() === 'collection_group' && literal) {
    return { ...base, collectionGroup: literal };
  }
  if (source.name.toLowerCase() === 'collection' && literal) {
    return { ...base, classification: 'native', collectionPath: literal };
  }
  return base;
}

function defaultSourcePlan(options: FirestoreSqlPlannerOptions): SourcePlan {
  return {
    classification: 'local',
    projectId: options.defaultProjectId,
    sourceKind: 'collection',
  };
}

function projectIdForSource(source: ProjectSource, options: FirestoreSqlPlannerOptions): string {
  if (source.project.kind === 'literal' && source.project.valueType === 'string') {
    return String(source.project.value);
  }
  if (source.project.kind === 'parameter') {
    return options.projectAliases?.[source.project.name] ?? options.defaultProjectId;
  }
  return options.defaultProjectId;
}

function classifyFilter(expression: FirestoreSqlExpression): StageClassification {
  if (expression.kind === 'binary' && ['and', 'or'].includes(expression.operator)) {
    return classifyFilter(expression.left) === 'native'
        && classifyFilter(expression.right) === 'native'
      ? 'native'
      : 'local';
  }
  if (expression.kind === 'binary') {
    return isNativeComparable(expression.left) && isNativeComparable(expression.right)
      ? 'native'
      : 'local';
  }
  if (
    expression.kind === 'call'
    && ['array_contains', 'array_contains_any'].includes(expression.name.toLowerCase())
  ) {
    return 'native';
  }
  return 'local';
}

function isNativeComparable(expression: FirestoreSqlExpression): boolean {
  if (expression.kind === 'literal') return true;
  if (expression.kind === 'fieldPath') return true;
  return expression.kind === 'call'
    && ['date', 'id', 'timestamp'].includes(expression.name.toLowerCase());
}

function hasAggregate(expression: FirestoreSqlExpression): boolean {
  if (
    expression.kind === 'call'
    && ['avg', 'count', 'max', 'min', 'sum'].includes(expression.name.toLowerCase())
  ) {
    return true;
  }
  return childExpressions(expression).some(hasAggregate);
}

function isComputedExpression(expression: FirestoreSqlExpression): boolean {
  if (expression.kind === 'fieldPath' || expression.kind === 'wildcard') return false;
  if (
    expression.kind === 'call'
    && ['id', 'parent_path', 'parent_ref', 'path', 'project_id', 'ref'].includes(
      expression.name.toLowerCase(),
    )
  ) {
    return false;
  }
  return true;
}

function childExpressions(expression: FirestoreSqlExpression): readonly FirestoreSqlExpression[] {
  switch (expression.kind) {
    case 'array':
    case 'tuple':
      return expression.items;
    case 'binary':
      return [expression.left, expression.right];
    case 'call':
      return expression.args;
    case 'case':
      return [
        ...expression.cases.flatMap((branch) => [branch.when, branch.result]),
        ...(expression.else ? [expression.else] : []),
      ];
    case 'existsSubquery':
    case 'fieldPath':
    case 'literal':
    case 'parameter':
    case 'unary':
    case 'wildcard':
      return expression.kind === 'unary' ? [expression.expression] : [];
  }
}
