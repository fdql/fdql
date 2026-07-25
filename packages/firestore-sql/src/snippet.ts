import type {
  FirestoreSqlPlan,
  JoinPlanStage,
  PlanStage,
  ProjectPlanStage,
  ReadPlanStage,
  SourcePlan,
  UnionBranchPlanStage,
} from './planner.ts';

export interface FirestoreSqlSnippetResult {
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly severity: 'error' | 'warning';
  }[];
  readonly source: string;
}

type SnippetDiagnostic = FirestoreSqlSnippetResult['diagnostics'][number];

export function generateFirestoreDeskJsQuerySnippet(
  plan: FirestoreSqlPlan,
): FirestoreSqlSnippetResult {
  const diagnostics = unsupportedDiagnostics(plan);
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics, source: '' };
  }

  const body = plan.kind === 'unionAll'
    ? unionSnippet(plan.stages)
    : selectSnippet(plan.stages, 'rows');
  return {
    diagnostics,
    source: [
      '// Generated from Firebase Desk SQL. Review before running.',
      'const rows = [];',
      body,
      "console.log('SQL rows', rows.length);",
      'yield rows;',
      'return rows;',
      '',
    ].join('\n'),
  };
}

function unionSnippet(stages: readonly PlanStage[]): string {
  return stages
    .filter((stage): stage is UnionBranchPlanStage => stage.kind === 'unionBranch')
    .map((branch) => selectSnippet(branch.stages, 'rows', branch.branchIndex))
    .join('\n');
}

function selectSnippet(
  stages: readonly PlanStage[],
  outputName: string,
  branchIndex?: number,
): string {
  const read = stages.find((stage): stage is ReadPlanStage => stage.kind === 'read');
  const project = stages.find((stage): stage is ProjectPlanStage => stage.kind === 'project');
  const joins = stages.filter((stage): stage is JoinPlanStage => stage.kind === 'join');
  const execution = stages.find((stage) => stage.kind === 'execution')?.execution ?? {};
  if (!read || !project) return '// Unsupported plan shape.';

  const baseAlias = aliasFor(read.source);
  const lines = [
    `for (const ${baseAlias} of await readSource(${
      sourceSnippet(read.source, execution.limit)
    })) {`,
  ];
  if (joins.length > 0) {
    lines.push(
      `  // Joins from SQL plan: ${joins.map((join) => aliasFor(join.source)).join(', ')}`,
    );
    lines.push('  // Keep this generated snippet as a starting point for custom JS Query logic.');
  }
  lines.push(`  ${outputName}.push(${projectionSnippet(project, baseAlias, branchIndex)});`);
  lines.push('}');
  lines.push('');
  lines.push(helperSnippet());
  return lines.join('\n');
}

function sourceSnippet(source: SourcePlan, limit: number | undefined): string {
  const path = source.collectionPath ?? source.collectionGroup ?? aliasFor(source);
  const method = source.collectionGroup ? 'collectionGroup' : 'collection';
  const limitPart = limit === undefined ? '' : `.limit(${limit})`;
  return `db.${method}(${quote(path)})${limitPart}.get()`;
}

function projectionSnippet(
  project: ProjectPlanStage,
  baseAlias: string,
  branchIndex: number | undefined,
): string {
  if (project.columns.length === 1 && project.columns[0]?.expression.kind === 'wildcard') {
    const data = wildcardDataSnippet(project.columns[0].expression, baseAlias);
    return branchIndex === undefined
      ? `{ id: ${baseAlias}.id, ...${data} }`
      : `{ branch: ${branchIndex}, id: ${baseAlias}.id, ...${data} }`;
  }
  const fields = project.columns.map((column, index) =>
    `${quote(column.alias ?? `column${index + 1}`)}: ${
      expressionComment(column.expression, baseAlias)
    }`
  );
  if (branchIndex !== undefined) fields.unshift(`branch: ${branchIndex}`);
  return `{ ${fields.join(', ')} }`;
}

function wildcardDataSnippet(
  expression: ProjectPlanStage['columns'][number]['expression'] & { readonly kind: 'wildcard'; },
  baseAlias: string,
): string {
  const qualifier = expression.qualifier?.map((part) => part.text) ?? [];
  if (qualifier.length === 0) return `${baseAlias}.data()`;
  const [alias, ...path] = qualifier;
  if (alias !== baseAlias) return '{} /* wildcard source needs manual review */';
  return path.length === 0
    ? `${baseAlias}.data()`
    : `(field(${baseAlias}.data(), ${quote(path.join('.'))}) ?? {})`;
}

function expressionComment(
  expression: ProjectPlanStage['columns'][number]['expression'],
  baseAlias: string,
): string {
  if (expression.kind === 'fieldPath') {
    const [, ...path] = expression.parts.map((part) => part.text);
    return path.length === 0
      ? `${baseAlias}.data()`
      : `field(${baseAlias}.data(), ${quote(path.join('.'))})`;
  }
  if (expression.kind === 'call' && expression.name.toLowerCase() === 'id') {
    return `${baseAlias}.id`;
  }
  if (expression.kind === 'call' && expression.name.toLowerCase() === 'path') {
    return `${baseAlias}.ref.path`;
  }
  return 'undefined /* computed expression: review generated SQL plan */';
}

function helperSnippet(): string {
  return [
    'async function readSource(query) {',
    '  const snapshot = await query;',
    '  return snapshot.docs;',
    '}',
    '',
    'function field(data, path) {',
    "  return path.split('.').reduce((value, key) => value?.[key], data);",
    '}',
  ].join('\n');
}

function unsupportedDiagnostics(plan: FirestoreSqlPlan): FirestoreSqlSnippetResult['diagnostics'] {
  const diagnostics: SnippetDiagnostic[] = [];
  if (plan.kind !== 'select' && plan.kind !== 'unionAll') {
    diagnostics.push({
      code: 'UNSUPPORTED_SNIPPET_COMMAND',
      message: `${plan.kind} snippets are not supported.`,
      severity: 'error',
    });
  }
  for (const stage of flattenStages(plan.stages)) {
    if (stage.kind === 'aggregate') {
      diagnostics.push({
        code: 'UNSUPPORTED_SNIPPET_AGGREGATION',
        message: 'Aggregation snippets are deferred.',
        severity: 'error',
      });
    }
    if (stage.kind === 'join' && stage.source.classification !== 'local') {
      diagnostics.push({
        code: 'SNIPPET_JOIN_REVIEW_REQUIRED',
        message: 'Join snippets need manual review.',
        severity: 'warning',
      });
    }
  }
  return diagnostics;
}

function flattenStages(stages: readonly PlanStage[]): readonly PlanStage[] {
  return stages.flatMap((stage) =>
    stage.kind === 'unionBranch' ? [stage, ...flattenStages(stage.stages)] : [stage]
  );
}

function aliasFor(source: SourcePlan): string {
  return source.alias ?? source.collectionPath?.replaceAll(/[^\w]/g, '_') ?? 'doc';
}

function quote(value: string): string {
  return JSON.stringify(value);
}
