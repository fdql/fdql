import type { FdqlAst, FdqlDiagnostic, FdqlUnionProgram } from '../types.ts';

export function parserError(
  code: string,
  message: string,
  line: number,
  column: number,
): FdqlDiagnostic {
  return { code, column, line, message, severity: 'error' };
}

export function providerFromStatement(text: string): string | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+(where|order by|limit)\b/i.exec(text);
  return match?.[1] ?? null;
}

export function isProviderClauseStart(text: string): boolean {
  return Boolean(providerFromStatement(text));
}

export function isStatementStart(text: string): boolean {
  return /^(set|alias|from|then |return|union all|yield)\b/.test(text)
    || isProviderClauseStart(text);
}

export function isUnionAst(ast: FdqlAst): ast is FdqlUnionProgram {
  return 'kind' in ast && ast.kind === 'union';
}
