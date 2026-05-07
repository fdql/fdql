import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlProviderOrderByValidationInput,
  FdqlProviderPredicateValidationInput,
} from '@firebase-desk/fdql-core';
import { readFieldPathSegments } from './field-mask.ts';
import { firestoreError, walkExpression } from './helpers.ts';

export function validateFirestoreWhere(input: FdqlProviderPredicateValidationInput): void {
  validateFirestorePredicate(
    input.expression,
    input.rowAlias,
    input.lookup,
    input.diagnostics,
    input.line,
  );
  walkExpression(input.expression, (node, parent) => {
    if (
      node.kind === 'call'
      && ![
        'bytes',
        'fs.arrayContains',
        'fs.fieldPath',
        'fs.id',
        'fs.ref',
        'geoPoint',
        'timestamp',
      ].includes(node.name)
    ) {
      input.diagnostics.push(
        firestoreError(
          'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE',
          `${node.name} is not valid in ${input.lookup ? 'lookup ' : ''}fs where.`,
          input.line,
        ),
      );
    }
    if (node.kind === 'call' && node.name === 'fs.fieldPath') {
      readFieldPathSegments(node, input.diagnostics, input.line);
    }
    if (node.kind === 'field' && !isMetadataArgument(node, parent)) {
      const binding = node.path[0];
      if (node.path.length === 1) {
        validateProviderField(node.path, input.rowAlias, input.diagnostics, input.line);
      } else if (!binding || !input.availableRowAliases.has(binding)) {
        input.diagnostics.push(
          firestoreError('FDQL_UNKNOWN_BINDING', `Unknown row binding ${binding}.`, input.line),
        );
      } else if (binding === input.rowAlias) {
        validateProviderField(node.path, input.rowAlias, input.diagnostics, input.line);
      }
    }
  });
}

export function validateFirestoreOrderBy(input: FdqlProviderOrderByValidationInput): void {
  if (input.expression.kind === 'field') {
    validateProviderField(input.expression.path, input.rowAlias, input.diagnostics, input.line);
    return;
  }
  if (
    input.expression.kind === 'call'
    && (input.expression.name === 'fs.id' || input.expression.name === 'fs.fieldPath')
  ) {
    if (input.expression.name === 'fs.fieldPath') {
      readFieldPathSegments(input.expression, input.diagnostics, input.line);
    }
    return;
  }
  input.diagnostics.push(
    firestoreError(
      'FDQL_UNSUPPORTED_FS_ORDER_BY',
      '`fs order by` needs a provider field.',
      input.line,
    ),
  );
}

export function hasBoundedIdPredicate(
  expression: FdqlExpression | undefined,
  rowAlias: string,
): boolean {
  if (!expression) return false;
  if (expression.kind === 'binary' && expression.operator === 'and') {
    return hasBoundedIdPredicate(expression.left, rowAlias)
      || hasBoundedIdPredicate(expression.right, rowAlias);
  }
  if (expression.kind !== 'binary' || expression.operator !== '=') return false;
  return isIdCall(expression.left, rowAlias) || isIdCall(expression.right, rowAlias);
}

function validateFirestorePredicate(
  expression: FdqlExpression,
  rowAlias: string,
  lookup: boolean,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (
    expression.kind === 'binary' && (expression.operator === 'and' || expression.operator === 'or')
  ) {
    validateFirestorePredicate(expression.left, rowAlias, lookup, diagnostics, line);
    validateFirestorePredicate(expression.right, rowAlias, lookup, diagnostics, line);
    return;
  }
  if (expression.kind === 'binary') {
    if (!isProviderOperand(expression.left, rowAlias)) {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          lookup
            ? '`lookup` fs where comparisons need the lookup provider field on the left.'
            : '`fs where` comparisons need a provider field on the left.',
          line,
        ),
      );
    }
    if (!lookup && !isProviderValueExpression(expression.right)) {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs where` comparison values must be literals, aliases, arrays, maps, or core value constructors.',
          line,
        ),
      );
    }
    return;
  }
  if (expression.kind === 'call' && expression.name === 'fs.arrayContains') {
    if (!isProviderOperand(expression.args[0], rowAlias)) {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          lookup
            ? '`fs.arrayContains` needs a lookup provider field.'
            : '`fs.arrayContains` needs a provider field and a provider value.',
          line,
        ),
      );
    }
    if (!lookup && !isProviderValueExpression(expression.args[1])) {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs.arrayContains` needs a provider field and a provider value.',
          line,
        ),
      );
    }
    return;
  }
  diagnostics.push(
    firestoreError(
      'FDQL_UNSUPPORTED_FS_WHERE',
      lookup
        ? '`lookup` fs where needs provider predicates.'
        : '`fs where` needs provider comparison predicates.',
      line,
    ),
  );
}

function isIdCall(expression: FdqlExpression, rowAlias: string): boolean {
  return expression.kind === 'call'
    && expression.name === 'fs.id'
    && expression.args[0]?.kind === 'field'
    && expression.args[0].path.length === 1
    && expression.args[0].path[0] === rowAlias;
}

function isProviderOperand(
  expression: FdqlExpression | undefined,
  rowAlias: string,
): expression is Extract<FdqlExpression, { readonly kind: 'call' | 'field'; }> {
  if (!expression) return false;
  if (expression.kind === 'field') return expression.path[0] === rowAlias;
  if (expression.kind !== 'call') return false;
  return isIdCall(expression, rowAlias) || expression.name === 'fs.fieldPath';
}

function isProviderValueExpression(expression: FdqlExpression | undefined): boolean {
  if (!expression) return false;
  if (expression.kind === 'literal' || expression.kind === 'alias') return true;
  if (expression.kind === 'array') return expression.items.every(isProviderValueExpression);
  if (expression.kind === 'map') {
    return expression.entries.every((entry) => isProviderValueExpression(entry.value));
  }
  if (
    expression.kind === 'call'
    && ['bytes', 'fs.ref', 'geoPoint', 'timestamp'].includes(expression.name)
  ) {
    return expression.args.every(isProviderValueExpression);
  }
  return false;
}

function isMetadataArgument(
  expression: Extract<FdqlExpression, { readonly kind: 'field'; }>,
  parent: FdqlExpression | undefined,
): boolean {
  return parent?.kind === 'call'
    && ['fs.id', 'fs.path', 'fs.projectId', 'fs.ref'].includes(parent.name)
    && parent.args[0] === expression
    && expression.path.length === 1;
}

function validateProviderField(
  path: readonly string[],
  rowAlias: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (path.length === 1) {
    diagnostics.push(
      firestoreError(
        'FDQL_UNQUALIFIED_PROVIDER_FIELD',
        `Provider field ${path[0]} must be qualified.`,
        line,
      ),
    );
  } else if (path[0] !== rowAlias) {
    diagnostics.push(
      firestoreError('FDQL_UNKNOWN_BINDING', `Unknown provider row binding ${path[0]}.`, line),
    );
  }
}
