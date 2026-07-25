import type { AnalysisDiagnostic, FirestoreSqlAnalysisContext } from './analyzer.ts';
import { analyzeFirestoreSql } from './analyzer.ts';
import { type FirestoreSqlStatement, parseFirestoreSql } from './parser.ts';
import type { FirestoreSqlPlan, FirestoreSqlPlannerOptions, PlanStage } from './planner.ts';
import { planFirestoreSql } from './planner.ts';

export interface FirestoreSqlReadCompileOptions extends FirestoreSqlPlannerOptions {
  readonly readBudget?: number;
  readonly timeoutMs?: number;
}

export type FirestoreSqlReadCompileResult =
  | {
    readonly ast: FirestoreSqlStatement;
    readonly diagnostics: readonly AnalysisDiagnostic[];
    readonly ok: true;
    readonly plan: FirestoreSqlPlan;
  }
  | {
    readonly ast?: FirestoreSqlStatement;
    readonly diagnostics: readonly AnalysisDiagnostic[];
    readonly ok: false;
    readonly plan?: FirestoreSqlPlan;
  };

export function compileFirestoreSqlRead(
  input: string,
  options: FirestoreSqlReadCompileOptions,
): FirestoreSqlReadCompileResult {
  const parsed = parseFirestoreSql(input);
  if (!parsed.ok) {
    return {
      diagnostics: parsed.diagnostics.map((item) => ({
        ...item,
        severity: 'error' as const,
      })),
      ok: false,
    };
  }

  const context: FirestoreSqlAnalysisContext = options;
  const analysis = analyzeFirestoreSql(parsed.ast, context);
  const unsupported = unsupportedReadDiagnostics(parsed.ast);
  if (!analysis.ok || unsupported.length > 0) {
    return {
      ast: parsed.ast,
      diagnostics: [...analysis.diagnostics, ...unsupported],
      ok: false,
    };
  }

  const planning = planFirestoreSql(parsed.ast, analysis, {
    ...options,
    executionDefaults: executionDefaultsFor(options),
  });
  const planDiagnostics = planning.diagnostics.filter((diagnostic) =>
    !analysis.diagnostics.includes(diagnostic)
  );
  const unsupportedPlan = unsupportedPlanDiagnostics(planning.plan);
  const blockingDiagnostics = [...planDiagnostics, ...unsupportedPlan];
  const diagnostics = [
    ...analysis.diagnostics,
    ...planDiagnostics,
    ...unsupportedPlan,
    ...(blockingDiagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? []
      : scanWarnings(planning.plan)),
  ];

  if (
    diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    || !planning.plan
  ) {
    return {
      ast: parsed.ast,
      diagnostics,
      ok: false,
      ...(planning.plan ? { plan: planning.plan } : {}),
    };
  }

  return { ast: parsed.ast, diagnostics, ok: true, plan: planning.plan };
}

function executionDefaultsFor(options: FirestoreSqlReadCompileOptions) {
  return {
    ...(options.executionDefaults?.limit === undefined
      ? {}
      : { limit: options.executionDefaults.limit }),
    pageSize: options.executionDefaults?.pageSize ?? 100,
    readBudget: options.readBudget ?? options.executionDefaults?.readBudget ?? 5000,
    timeoutMs: options.timeoutMs ?? options.executionDefaults?.timeoutMs ?? 60_000,
  };
}

function scanWarnings(plan: FirestoreSqlPlan | undefined): readonly AnalysisDiagnostic[] {
  if (!plan) return [];
  const diagnostics: AnalysisDiagnostic[] = [];
  for (const stages of selectStageGroups(plan)) {
    const execution = stages.find((stage) => stage.kind === 'execution')?.execution;
    if (execution?.limit !== undefined) continue;
    const read = stages.find((stage) => stage.kind === 'read');
    if (read?.kind === 'read' && read.source.classification === 'native') {
      diagnostics.push({
        code: 'HIDDEN_SCAN_WARNING',
        message:
          'This query can scan the source until the read budget, timeout, or cancellation stops it.',
        severity: 'warning',
      });
    }
  }
  return diagnostics;
}

function selectStageGroups(plan: FirestoreSqlPlan): readonly (readonly PlanStage[])[] {
  if (plan.kind === 'unionAll') {
    return plan.stages
      .filter((stage) => stage.kind === 'unionBranch')
      .map((stage) => stage.stages);
  }
  return [plan.stages];
}

function unsupportedReadDiagnostics(
  statement: FirestoreSqlStatement,
): readonly AnalysisDiagnostic[] {
  if (statement.kind === 'select') return [];
  if (statement.kind === 'unionAll') return [];
  return [
    {
      code: 'UNSUPPORTED_READ_COMMAND',
      message: `${statement.kind} is not supported in the read-only SQL tab.`,
      severity: 'error',
    },
  ];
}

function unsupportedPlanDiagnostics(
  plan: FirestoreSqlPlan | undefined,
): readonly AnalysisDiagnostic[] {
  if (!plan) return [];
  const diagnostics: AnalysisDiagnostic[] = [];
  for (const stage of flattenStages(plan.stages)) {
    if (stage.kind === 'aggregate') {
      diagnostics.push({
        code: 'UNSUPPORTED_AGGREGATION',
        message: 'Aggregation is not supported in the first read-only SQL release.',
        severity: 'error',
      });
    }
    if (stage.kind === 'write') {
      diagnostics.push({
        code: 'UNSUPPORTED_READ_COMMAND',
        message: 'Writes are not supported in the read-only SQL tab.',
        severity: 'error',
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
