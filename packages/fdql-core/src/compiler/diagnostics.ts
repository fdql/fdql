import type { FdqlDiagnostic, FdqlNameRef, FdqlSourceRange } from '../types.ts';

export function compilerError(
  code: string,
  message: string,
  line?: number,
  column?: number,
): FdqlDiagnostic {
  return {
    code,
    ...(column ? { column } : {}),
    ...(line ? { line } : {}),
    message,
    severity: 'error',
  };
}

export function diagnosticAtRange(
  code: string,
  message: string,
  range: FdqlSourceRange | undefined,
  line?: number,
  column?: number,
): FdqlDiagnostic {
  if (!range) return compilerError(code, message, line, column);
  return {
    code,
    column: range.startColumn,
    endColumn: range.endColumn,
    endLine: range.endLine,
    line: range.startLine,
    message,
    range,
    severity: 'error',
  };
}

export function diagnosticAtName(
  code: string,
  message: string,
  ref: FdqlNameRef | undefined,
  line?: number,
  column?: number,
): FdqlDiagnostic {
  return ref
    ? diagnosticAtRange(code, message, ref.range)
    : compilerError(code, message, line, column);
}

export function diagnosticAtStage(
  code: string,
  message: string,
  range: FdqlSourceRange | undefined,
  line?: number,
  column?: number,
): FdqlDiagnostic {
  return range
    ? diagnosticAtRange(code, message, range)
    : compilerError(code, message, line, column);
}

export function duplicateStage(
  stage: string,
  firstLine: number,
  duplicateLine: number,
  duplicateRange?: FdqlSourceRange | undefined,
): FdqlDiagnostic {
  return diagnosticAtStage(
    'FDQL_DUPLICATE_STAGE',
    `${stage} can only appear once for the current provider source. First used on line ${firstLine}.`,
    duplicateRange,
    duplicateLine,
  );
}
