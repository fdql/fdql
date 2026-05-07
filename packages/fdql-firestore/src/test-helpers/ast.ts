import type {
  FdqlAliasDeclaration,
  FdqlExpression,
  FdqlSourceRange,
} from '@firebase-desk/fdql-core';

export function aliasDeclaration(name: string, value: FdqlExpression): FdqlAliasDeclaration {
  return { column: 1, line: 1, name, range: sourceRange(), value };
}

export function alias(name: string): FdqlExpression {
  return { kind: 'alias', name };
}

export function array(...items: readonly FdqlExpression[]): FdqlExpression {
  return { items, kind: 'array' };
}

export function binary(
  left: FdqlExpression,
  operator: Extract<FdqlExpression, { readonly kind: 'binary'; }>['operator'],
  right: FdqlExpression,
): FdqlExpression {
  return { kind: 'binary', left, operator, right };
}

export function call(name: string, ...args: readonly FdqlExpression[]): FdqlExpression {
  return { args, kind: 'call', name };
}

export function field(...path: readonly string[]): FdqlExpression {
  return { kind: 'field', path };
}

export function literal(value: boolean | number | string | null): FdqlExpression {
  return { kind: 'literal', value };
}

export function sourceRange(): FdqlSourceRange {
  return { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
}
