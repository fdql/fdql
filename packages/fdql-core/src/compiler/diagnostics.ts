import type { FdqlDiagnostic } from '../types.ts';

export function compilerError(
  code: string,
  message: string,
  line?: number,
): FdqlDiagnostic {
  return { code, ...(line ? { line } : {}), message, severity: 'error' };
}

export function duplicateStage(
  stage: string,
  firstLine: number,
  duplicateLine: number,
): FdqlDiagnostic {
  return compilerError(
    'FDQL_DUPLICATE_STAGE',
    `${stage} can only appear once for the current provider source. First used on line ${firstLine}.`,
    duplicateLine,
  );
}
