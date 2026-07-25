import type { FdqlDiagnostic, FdqlExpression, FdqlFieldMaskField } from '@firebase-desk/fdql-core';
import { firestoreError } from './helpers.ts';

export function readFieldMask(
  expression: FdqlExpression | undefined,
  diagnostics: FdqlDiagnostic[],
  line: number,
): readonly FdqlFieldMaskField[] | undefined {
  if (!expression) return undefined;
  if (expression.kind !== 'array') {
    diagnostics.push(
      firestoreError(
        'FDQL_INVALID_FIELD_MASK',
        'Top-level source field masks must be literal arrays.',
        line,
      ),
    );
    return undefined;
  }
  if (expression.items.length > 150) {
    diagnostics.push(
      firestoreError(
        'FDQL_INVALID_FIELD_MASK',
        'Field masks can include at most 150 fields.',
        line,
      ),
    );
  }
  return expression.items.flatMap((item) => {
    if (item.kind === 'literal' && typeof item.value === 'string') {
      return fieldMaskFromSegments(item.value.split('.'), diagnostics, line);
    }
    if (item.kind === 'call' && item.name === 'fs.fieldPath') {
      return fieldMaskFromSegments(
        readFieldPathSegments(item, diagnostics, line),
        diagnostics,
        line,
      );
    }
    diagnostics.push(
      firestoreError(
        'FDQL_INVALID_FIELD_MASK',
        'Field mask entries must be strings or fs.fieldPath(...).',
        line,
      ),
    );
    return [];
  });
}

export function readFieldPathSegments(
  expression: Extract<FdqlExpression, { readonly kind: 'call'; }>,
  diagnostics: FdqlDiagnostic[],
  line: number,
): readonly string[] {
  if (expression.args.length === 0) {
    diagnostics.push(
      firestoreError('FDQL_INVALID_FIELD_PATH', 'fs.fieldPath needs at least one segment.', line),
    );
    return [];
  }
  return expression.args.flatMap((arg) => {
    if (arg.kind === 'literal' && typeof arg.value === 'string') return [arg.value];
    diagnostics.push(
      firestoreError(
        'FDQL_INVALID_FIELD_PATH',
        'fs.fieldPath segments must be literal strings.',
        line,
      ),
    );
    return [];
  });
}

function fieldMaskFromSegments(
  segments: readonly string[],
  diagnostics: FdqlDiagnostic[],
  line: number,
): readonly FdqlFieldMaskField[] {
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    diagnostics.push(
      firestoreError('FDQL_INVALID_FIELD_PATH', 'Field paths need non-empty segments.', line),
    );
    return [];
  }
  return [{ segments }];
}
