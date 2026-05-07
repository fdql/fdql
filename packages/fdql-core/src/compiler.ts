import { compileFdqlCommand } from './compiler/command.ts';
import { defaultSettings } from './compiler/settings.ts';
import { compileSingleFdqlRead, isUnionAst } from './compiler/source-read.ts';
import type {
  FdqlCompileOptions,
  FdqlCompileResult,
  FdqlProgram,
  FdqlReadCompileResult,
  FdqlSingleReadPlan,
  FdqlUnionProgram,
} from './types.ts';

export function compileFdqlRead(
  source: string,
  options: FdqlCompileOptions,
): FdqlReadCompileResult {
  const unionParts = splitUnionAll(source);
  if (unionParts.length > 1) return compileUnionRead(unionParts, options);
  return compileSingleFdqlRead(source, options);
}

export function compileFdql(
  source: string,
  options: FdqlCompileOptions,
): FdqlCompileResult {
  const command = compileFdqlCommand(source, options);
  if (command) return command;
  return compileFdqlRead(source, options);
}

function compileUnionRead(
  unionParts: readonly string[],
  options: FdqlCompileOptions,
): FdqlReadCompileResult {
  const preamble = sharedPreamble(unionParts[0]!);
  const branches = unionParts.map((part, index) =>
    index === 0 ? part : `${preamble}${preamble ? '\n' : ''}${part}`
  );
  const compiledBranches = branches.map((branch) => compileSingleFdqlRead(branch, options));
  const diagnostics = compiledBranches.flatMap((branch) => branch.diagnostics);
  const plans: FdqlSingleReadPlan[] = compiledBranches.flatMap((branch) =>
    branch.ok && branch.plan.kind === 'read' ? [branch.plan] : []
  );
  const astBranches: FdqlProgram[] = compiledBranches.flatMap((branch) =>
    branch.ast && !isUnionAst(branch.ast) ? [branch.ast] : []
  );
  const ast: FdqlUnionProgram = { branches: astBranches, kind: 'union' };
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    || plans.length !== branches.length
  ) {
    return { ast, diagnostics, ok: false };
  }
  return {
    ast,
    diagnostics,
    ok: true,
    plan: {
      branches: plans,
      kind: 'union',
      settings: plans[0]?.settings ?? defaultSettings,
    },
  };
}

function splitUnionAll(source: string): readonly string[] {
  const parts: string[] = [];
  const lines = source.split(/\r?\n/);
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().toLowerCase() === 'union all') {
      parts.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  parts.push(current.join('\n').trim());
  return parts.filter(Boolean);
}

function sharedPreamble(source: string): string {
  const lines = source.split(/\r?\n/);
  const preamble: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (preamble.length) preamble.push(line);
      continue;
    }
    if (trimmed.startsWith('set ') || trimmed.startsWith('alias ')) {
      preamble.push(line);
      continue;
    }
    break;
  }
  return preamble.join('\n').trim();
}
