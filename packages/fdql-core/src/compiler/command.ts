import { parseFdql } from '../parser.ts';
import { createProviderDialectRegistry, type FdqlProviderDialectRegistry } from '../provider.ts';
import type {
  FdqlAst,
  FdqlClearCacheCommandPlan,
  FdqlCompileOptions,
  FdqlCompileResult,
  FdqlDiagnostic,
  FdqlProgram,
  FdqlStage,
  FdqlUnionProgram,
} from '../types.ts';
import { compilerError } from './diagnostics.ts';

type ClearCacheCommandStage = Extract<FdqlStage, { readonly kind: 'unsupported'; }>;

export function compileFdqlCommand(
  source: string,
  options: FdqlCompileOptions,
): FdqlCompileResult | null {
  const parsed = parseFdql(source);
  const ast = parsed.ast;
  if (!ast) return null;
  const commandStage = clearCacheCommandStage(ast);
  if (!commandStage) return null;
  const diagnostics: FdqlDiagnostic[] = [...parsed.diagnostics];
  if (isUnionAst(ast) || !isStandaloneCommand(ast, commandStage)) {
    diagnostics.push(compilerError(
      'FDQL_COMMAND_MIXED_WITH_PIPELINE',
      '`clear cache` must be the only command in the FDQL source.',
      commandStage.line,
    ));
    return { ast, diagnostics, ok: false };
  }
  if (!parsed.ok) return { ast, diagnostics, ok: false };
  const plan = parseClearCacheCommand(commandStage, providerRegistry(options), diagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !plan) {
    return { ast, diagnostics, ok: false };
  }
  return { ast, diagnostics, ok: true, plan };
}

export function isReservedCommand(text: string): boolean {
  return /^clear\s+cache(?:\s+provider\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+project\s+(?:"[^"]+"|'[^']+'))?)?$/i
    .test(text);
}

function providerRegistry(options: FdqlCompileOptions): FdqlProviderDialectRegistry {
  return createProviderDialectRegistry(options.providers ?? []);
}

function isUnionAst(ast: FdqlAst): ast is FdqlUnionProgram {
  return 'kind' in ast && ast.kind === 'union';
}

function clearCacheCommandStage(ast: FdqlAst): ClearCacheCommandStage | null {
  const stages = isUnionAst(ast) ? ast.branches.flatMap((branch) => branch.stages) : ast.stages;
  return stages.find((stage): stage is ClearCacheCommandStage =>
    stage.kind === 'unsupported' && /^clear\s+cache\b/i.test(stage.text)
  ) ?? null;
}

function isStandaloneCommand(
  ast: FdqlProgram,
  commandStage: ClearCacheCommandStage,
): boolean {
  return ast.aliases.length === 0
    && ast.settings.length === 0
    && !ast.from
    && ast.stages.length === 1
    && ast.stages[0] === commandStage;
}

function parseClearCacheCommand(
  stage: ClearCacheCommandStage,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): FdqlClearCacheCommandPlan | null {
  const match =
    /^clear\s+cache(?:\s+provider\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+project\s+(?:"([^"]+)"|'([^']+)'))?)?$/i
      .exec(stage.text);
  if (!match) {
    diagnostics.push(compilerError(
      'FDQL_INVALID_COMMAND',
      '`clear cache` supports `clear cache`, `clear cache provider name`, or `clear cache provider name project "project-id"`.',
      stage.line,
    ));
    return null;
  }
  const provider = match[1];
  if (provider && !providers[provider]) {
    diagnostics.push(
      compilerError(
        'FDQL_UNKNOWN_NAMESPACE',
        `Unknown provider namespace ${provider}.`,
        stage.line,
      ),
    );
    return null;
  }
  const projectId = match[2] ?? match[3];
  return {
    kind: 'clearCache',
    ...(projectId ? { projectId } : {}),
    ...(provider ? { provider } : {}),
  };
}
