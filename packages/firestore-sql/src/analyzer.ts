import type {
  Assignment,
  BinaryExpression,
  CallExpression,
  CaseExpression,
  DeleteStatement,
  DiscoverSchemaStatement,
  FirestoreSqlExpression,
  FirestoreSqlSource,
  FirestoreSqlStatement,
  FunctionSource,
  InsertStatement,
  ParameterExpression,
  ProjectSource,
  RecursiveCteStatement,
  SelectStatement,
  UnionAllStatement,
  UpdateStatement,
} from './parser.ts';

export type AnalysisSeverity = 'error' | 'warning';

export interface AnalysisDiagnostic {
  readonly code: string;
  readonly column?: number;
  readonly line?: number;
  readonly message: string;
  readonly severity: AnalysisSeverity;
}

export interface FirestoreSqlSchemaStub {
  readonly collection: string;
  readonly projectId?: string;
}

export interface FirestoreSqlAnalysisContext {
  readonly defaultProjectId: string;
  readonly projectAliases?: Readonly<Record<string, string>>;
  readonly schemas?: readonly FirestoreSqlSchemaStub[];
}

export interface AnalysisResult {
  readonly diagnostics: readonly AnalysisDiagnostic[];
  readonly ok: boolean;
}

interface AliasInfo {
  readonly alias: string;
  readonly documentSource: boolean;
  readonly projectId: string;
  readonly source: FirestoreSqlSource;
}

interface AnalysisState {
  readonly context: FirestoreSqlAnalysisContext;
  readonly diagnostics: AnalysisDiagnostic[];
}

type ExpressionMode = 'read' | 'writeTarget' | 'writeValue';

const aggregateFunctions = new Set(['avg', 'count', 'max', 'min', 'sum']);
const metadataFunctions = new Set([
  'id',
  'key',
  'parent_path',
  'parent_ref',
  'path',
  'project_id',
  'ref',
  'value',
]);
const scalarFunctions = new Set([
  'array_contains',
  'array_contains_any',
  'bytes_base64',
  'coalesce',
  'concat',
  'date',
  'date_trunc',
  'double',
  'exists',
  'field_path',
  'geopoint',
  'increment',
  'int',
  'lower',
  'missing',
  'now',
  'round',
  'timestamp',
  'upper',
  'vector',
]);
const sourceFunctions = new Set([
  'collection',
  'collection_group',
  'entries',
  'subcollection',
  'subcollections',
  'unnest',
]);
const writeHelperFunctions = new Set([
  'array_remove',
  'array_union',
  'delete_field',
  'increment',
  'server_timestamp',
]);

export function analyzeFirestoreSql(
  ast: FirestoreSqlStatement,
  context: FirestoreSqlAnalysisContext,
): AnalysisResult {
  const state: AnalysisState = { context, diagnostics: [] };
  analyzeStatement(ast, state);
  return {
    diagnostics: state.diagnostics,
    ok: !state.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  };
}

function analyzeStatement(statement: FirestoreSqlStatement, state: AnalysisState): void {
  switch (statement.kind) {
    case 'delete':
      analyzeDelete(statement, state);
      return;
    case 'describe':
    case 'discoverSchema':
      analyzeSourceOnly(statement, state);
      return;
    case 'insert':
      analyzeInsert(statement, state);
      return;
    case 'recursiveCte':
      analyzeRecursiveCte(statement, state);
      return;
    case 'script':
      for (const child of statement.statements) analyzeStatement(child, state);
      return;
    case 'select':
      analyzeSelect(statement, state);
      return;
    case 'unionAll':
      analyzeUnion(statement, state);
      return;
    case 'update':
      analyzeUpdate(statement, state);
      return;
  }
}

function analyzeSourceOnly(
  statement: DiscoverSchemaStatement | { readonly source: FirestoreSqlSource; },
  state: AnalysisState,
): void {
  analyzeSource(statement.source, state, new Map());
}

function analyzeUnion(statement: UnionAllStatement, state: AnalysisState): void {
  for (const branch of statement.branches) analyzeSelect(branch, state);
}

function analyzeRecursiveCte(statement: RecursiveCteStatement, state: AnalysisState): void {
  analyzeStatement(statement.cte.query, state);
  analyzeSelect(statement.query, state);
}

function analyzeSelect(statement: SelectStatement, state: AnalysisState): Map<string, AliasInfo> {
  const aliases = new Map<string, AliasInfo>();
  addSourceAlias(statement.from, state, aliases);
  analyzeSource(statement.from, state, aliases);

  for (const join of statement.joins) {
    analyzeSource(join.source, state, aliases);
    addSourceAlias(join.source, state, aliases);
    if (join.condition) analyzeExpression(join.condition, state, aliases, 'read');
  }

  for (const column of statement.columns) {
    analyzeExpression(column.expression, state, aliases, 'read');
  }
  if (statement.where) analyzeExpression(statement.where, state, aliases, 'read');
  for (const item of statement.groupBy ?? []) analyzeExpression(item, state, aliases, 'read');
  if (statement.having) analyzeExpression(statement.having, state, aliases, 'read');
  for (const item of statement.orderBy ?? []) {
    analyzeExpression(item.expression, state, aliases, 'read');
  }
  return aliases;
}

function analyzeDelete(statement: DeleteStatement, state: AnalysisState): void {
  const aliases = new Map<string, AliasInfo>();
  addSourceAlias(statement.from, state, aliases);
  analyzeSource(statement.from, state, aliases);

  for (const join of statement.joins) {
    analyzeSource(join.source, state, aliases);
    addSourceAlias(join.source, state, aliases);
    if (join.condition) analyzeExpression(join.condition, state, aliases, 'read');
  }

  if (statement.using) {
    analyzeSource(statement.using.source, state, aliases);
    addSourceAlias(statement.using.source, state, aliases);
    for (const join of statement.using.joins) {
      analyzeSource(join.source, state, aliases);
      addSourceAlias(join.source, state, aliases);
      if (join.condition) analyzeExpression(join.condition, state, aliases, 'read');
    }
  }

  if (statement.targetAlias) validateTargetAlias(statement.targetAlias, aliases, state, 'delete');
  if (statement.where) analyzeExpression(statement.where, state, aliases, 'read');
}

function analyzeUpdate(statement: UpdateStatement, state: AnalysisState): void {
  const aliases = new Map<string, AliasInfo>();

  if (statement.target.kind !== 'targetAlias') {
    addSourceAlias(statement.target, state, aliases);
    analyzeSource(statement.target, state, aliases);
  }

  if (statement.from) {
    analyzeSource(statement.from.source, state, aliases);
    addSourceAlias(statement.from.source, state, aliases);
    for (const join of statement.from.joins) {
      analyzeSource(join.source, state, aliases);
      addSourceAlias(join.source, state, aliases);
      if (join.condition) analyzeExpression(join.condition, state, aliases, 'read');
    }
  }

  if (statement.target.kind === 'targetAlias') {
    validateTargetAlias(statement.target.name, aliases, state, 'update');
  }

  for (const assignment of statement.set) analyzeAssignment(assignment, state, aliases);
  if (statement.where) analyzeExpression(statement.where, state, aliases, 'read');
}

function analyzeInsert(statement: InsertStatement, state: AnalysisState): void {
  analyzeSource(statement.target, state, new Map());
  for (const value of statement.values ?? []) {
    analyzeExpression(value, state, new Map(), 'writeValue');
  }
  if (statement.source) analyzeStatement(statement.source, state);
}

function analyzeAssignment(
  assignment: Assignment,
  state: AnalysisState,
  aliases: Map<string, AliasInfo>,
): void {
  analyzeExpression(assignment.target, state, aliases, 'writeTarget');
  analyzeExpression(assignment.value, state, aliases, 'writeValue');
}

function analyzeSource(
  source: FirestoreSqlSource,
  state: AnalysisState,
  aliases: Map<string, AliasInfo>,
): void {
  if (source.kind === 'project') {
    resolveProjectId(source, state);
    analyzeSource(source.source, state, aliases);
    return;
  }

  if (source.kind !== 'function') return;

  const name = source.name.toLowerCase();
  if (!sourceFunctions.has(name)) {
    addDiagnostic(state, 'UNKNOWN_SOURCE_FUNCTION', `Unknown source function ${source.name}.`);
  }

  validateCollectionFunction(source, state);
  for (const arg of source.args) analyzeExpression(arg, state, aliases, 'read');
}

function validateCollectionFunction(source: FunctionSource, state: AnalysisState): void {
  const name = source.name.toLowerCase();
  const firstArg = source.args[0];
  if (!firstArg || firstArg.kind !== 'literal' || firstArg.valueType !== 'string') return;

  const value = String(firstArg.value);
  if (name === 'collection' && !isCollectionPath(value)) {
    addDiagnostic(
      state,
      'INVALID_COLLECTION_PATH',
      `collection("${value}") must resolve to a Firestore collection path.`,
    );
  }
  if (name === 'collection_group' && (value.length === 0 || value.includes('/'))) {
    addDiagnostic(
      state,
      'INVALID_COLLECTION_GROUP_ID',
      `collection_group("${value}") accepts a collection id, not a path.`,
    );
  }
}

function analyzeExpression(
  expression: FirestoreSqlExpression,
  state: AnalysisState,
  aliases: Map<string, AliasInfo>,
  mode: ExpressionMode,
): void {
  switch (expression.kind) {
    case 'array':
    case 'tuple':
      for (const item of expression.items) analyzeExpression(item, state, aliases, mode);
      return;
    case 'binary':
      analyzeBinaryExpression(expression, state, aliases, mode);
      return;
    case 'call':
      analyzeCallExpression(expression, state, aliases, mode);
      return;
    case 'case':
      analyzeCaseExpression(expression, state, aliases, mode);
      return;
    case 'existsSubquery':
      analyzeStatement(expression.subquery, state);
      return;
    case 'fieldPath':
      if (expression.parts.length > 1) validateAlias(expression.parts[0]?.text, aliases, state);
      return;
    case 'unary':
      analyzeExpression(expression.expression, state, aliases, mode);
      return;
    case 'literal':
    case 'parameter':
    case 'wildcard':
      return;
  }
}

function analyzeBinaryExpression(
  expression: BinaryExpression,
  state: AnalysisState,
  aliases: Map<string, AliasInfo>,
  mode: ExpressionMode,
): void {
  analyzeExpression(expression.left, state, aliases, mode);
  analyzeExpression(expression.right, state, aliases, mode);
}

function analyzeCallExpression(
  expression: CallExpression,
  state: AnalysisState,
  aliases: Map<string, AliasInfo>,
  mode: ExpressionMode,
): void {
  const name = expression.name.toLowerCase();
  if (!isKnownFunction(name)) {
    addDiagnostic(state, 'UNKNOWN_FUNCTION', `Unknown function ${expression.name}.`);
  }
  if (writeHelperFunctions.has(name) && mode !== 'writeValue') {
    addDiagnostic(
      state,
      'WRITE_HELPER_OUTSIDE_WRITE_VALUE',
      `${expression.name}() is only valid in write values.`,
    );
  }
  if (metadataFunctions.has(name)) validateMetadataAlias(expression, aliases, state);

  for (const arg of expression.args) analyzeExpression(arg, state, aliases, mode);
}

function analyzeCaseExpression(
  expression: CaseExpression,
  state: AnalysisState,
  aliases: Map<string, AliasInfo>,
  mode: ExpressionMode,
): void {
  for (const branch of expression.cases) {
    analyzeExpression(branch.when, state, aliases, mode);
    analyzeExpression(branch.result, state, aliases, mode);
  }
  if (expression.else) analyzeExpression(expression.else, state, aliases, mode);
}

function addSourceAlias(
  source: FirestoreSqlSource,
  state: AnalysisState,
  aliases: Map<string, AliasInfo>,
): void {
  const alias = sourceAlias(source);
  if (!alias) return;
  if (aliases.has(alias)) {
    addDiagnostic(state, 'DUPLICATE_ALIAS', `Alias ${alias} is already defined.`);
    return;
  }
  aliases.set(alias, {
    alias,
    documentSource: isDocumentSource(source),
    projectId: sourceProjectId(source, state),
    source,
  });
}

function validateTargetAlias(
  alias: string,
  aliases: Map<string, AliasInfo>,
  state: AnalysisState,
  command: 'delete' | 'update',
): void {
  const target = aliases.get(alias);
  if (!target) {
    addDiagnostic(
      state,
      'UNKNOWN_TARGET_ALIAS',
      `${command} target alias ${alias} does not resolve to a source alias.`,
    );
  }
}

function validateAlias(
  alias: string | undefined,
  aliases: Map<string, AliasInfo>,
  state: AnalysisState,
): void {
  if (!alias || aliases.has(alias)) return;
  addDiagnostic(state, 'UNKNOWN_ALIAS', `Unknown alias ${alias}.`);
}

function validateMetadataAlias(
  expression: CallExpression,
  aliases: Map<string, AliasInfo>,
  state: AnalysisState,
): void {
  const firstArg = expression.args[0];
  if (!firstArg || firstArg.kind !== 'fieldPath' || firstArg.parts.length !== 1) return;
  validateAlias(firstArg.parts[0]?.text, aliases, state);
}

function resolveProjectId(source: ProjectSource, state: AnalysisState): string {
  return resolveProjectIdWithReporting(source, state, true);
}

function resolveProjectIdWithReporting(
  source: ProjectSource,
  state: AnalysisState,
  reportDiagnostics: boolean,
): string {
  const expression = source.project;
  if (expression.kind === 'literal' && expression.valueType === 'string') {
    return String(expression.value);
  }
  if (expression.kind === 'parameter') {
    return resolveProjectParameter(expression, state, reportDiagnostics);
  }

  if (reportDiagnostics) {
    addDiagnostic(
      state,
      'INVALID_PROJECT_EXPRESSION',
      'project(...) expects a string or context alias.',
    );
  }
  return state.context.defaultProjectId;
}

function resolveProjectParameter(
  expression: ParameterExpression,
  state: AnalysisState,
  reportDiagnostics: boolean,
): string {
  const projectId = state.context.projectAliases?.[expression.name];
  if (projectId) return projectId;
  if (reportDiagnostics) {
    addDiagnostic(
      state,
      'MISSING_PROJECT_ALIAS',
      `Project context alias $${expression.name} is not defined.`,
    );
  }
  return state.context.defaultProjectId;
}

function sourceProjectId(source: FirestoreSqlSource, state: AnalysisState): string {
  return source.kind === 'project'
    ? resolveProjectIdWithReporting(source, state, false)
    : state.context.defaultProjectId;
}

function sourceAlias(source: FirestoreSqlSource): string | undefined {
  if (source.alias) return source.alias;
  if (source.kind === 'collection') return source.name;
  if (source.kind === 'function') return source.name;
  return sourceAlias(source.source);
}

function isDocumentSource(source: FirestoreSqlSource): boolean {
  if (source.kind === 'project') return isDocumentSource(source.source);
  if (source.kind === 'collection') return true;
  return !['entries', 'subcollections', 'unnest'].includes(source.name.toLowerCase());
}

function isCollectionPath(value: string): boolean {
  const parts = value.split('/').filter(Boolean);
  return parts.length > 0 && parts.length % 2 === 1 && parts.join('/') === value;
}

function isKnownFunction(name: string): boolean {
  return (
    aggregateFunctions.has(name)
    || metadataFunctions.has(name)
    || scalarFunctions.has(name)
    || writeHelperFunctions.has(name)
  );
}

function addDiagnostic(
  state: AnalysisState,
  code: string,
  message: string,
  severity: AnalysisSeverity = 'error',
): void {
  state.diagnostics.push({ code, message, severity });
}
