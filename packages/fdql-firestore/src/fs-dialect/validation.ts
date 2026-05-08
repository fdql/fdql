import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlProviderAggregateValidationInput,
  FdqlProviderOrderByValidationInput,
  FdqlProviderPredicateValidationInput,
  FdqlValue,
} from '@firebase-desk/fdql-core';
import { evaluateExpression } from '@firebase-desk/fdql-core';
import { readFieldPathSegments } from './field-mask.ts';
import { firestoreError, walkExpression } from './helpers.ts';

export function validateFirestoreWhere(input: FdqlProviderPredicateValidationInput): void {
  validateNotInConstraints(input);
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
        'fs.arrayContainsAny',
        'fs.fieldPath',
        'fs.id',
        'fs.parentPath',
        'fs.ref',
        'fs.databaseId',
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
    if (node.kind === 'case') {
      input.diagnostics.push(
        firestoreError(
          'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE',
          `case is not valid in ${input.lookup ? 'lookup ' : ''}fs where.`,
          input.line,
        ),
      );
    }
    if (node.kind === 'postfix' && node.operator.includes('missing')) {
      input.diagnostics.push(
        firestoreError(
          'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE',
          `${node.operator} is not valid in ${input.lookup ? 'lookup ' : ''}fs where.`,
          input.line,
        ),
      );
    }
    if (
      node.kind === 'binary'
      && ['+', '-', '*', '/', '%'].includes(node.operator)
    ) {
      input.diagnostics.push(
        firestoreError(
          'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE',
          `Math expressions are not valid in ${input.lookup ? 'lookup ' : ''}fs where.`,
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

export function validateFirestoreAggregate(input: FdqlProviderAggregateValidationInput): void {
  if (input.functionName === 'fs.count') {
    if (input.expression.kind === 'call' && input.expression.args.length === 0) return;
    input.diagnostics.push(
      firestoreError('FDQL_UNSUPPORTED_FS_AGGREGATE', '`fs.count` takes no arguments.', input.line),
    );
    return;
  }
  const call = input.expression.kind === 'call' ? input.expression : null;
  const field = call?.args[0];
  if (!call || call.args.length !== 1 || !isAggregateField(field, input.rowAlias)) {
    input.diagnostics.push(
      firestoreError(
        'FDQL_UNSUPPORTED_FS_AGGREGATE',
        `${input.functionName} needs one Firestore provider field.`,
        input.line,
      ),
    );
    return;
  }
  if (field?.kind === 'call' && field.name === 'fs.fieldPath') {
    readFieldPathSegments(field, input.diagnostics, input.line);
  }
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
  if (expression.kind === 'postfix') {
    if (expression.operator === 'is missing' || expression.operator === 'is not missing') {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs where` cannot query missing fields natively.',
          line,
        ),
      );
      return;
    }
    if (!isProviderOperand(expression.expression, rowAlias)) {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs where` null checks need a provider field.',
          line,
        ),
      );
    }
    return;
  }
  if (expression.kind === 'binary') {
    if (!isFirestoreComparisonOperator(expression.operator)) {
      diagnostics.push(
        firestoreError(
          'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE',
          `Operator ${expression.operator} is not valid in ${lookup ? 'lookup ' : ''}fs where.`,
          line,
        ),
      );
      return;
    }
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
  if (
    expression.kind === 'call'
    && (expression.name === 'fs.arrayContains' || expression.name === 'fs.arrayContainsAny')
  ) {
    if (!isProviderOperand(expression.args[0], rowAlias)) {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          `${expression.name} needs a provider field.`,
          line,
        ),
      );
    }
    if (!lookup && !isProviderValueExpression(expression.args[1])) {
      diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          `${expression.name} needs a provider field and a provider value.`,
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

function isAggregateField(
  expression: FdqlExpression | undefined,
  rowAlias: string,
): expression is Extract<FdqlExpression, { readonly kind: 'call' | 'field'; }> {
  if (!expression) return false;
  if (expression.kind === 'field') {
    return expression.path[0] === rowAlias && expression.path.length > 1;
  }
  return expression.kind === 'call' && expression.name === 'fs.fieldPath';
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

function validateNotInConstraints(input: FdqlProviderPredicateValidationInput): void {
  const operators: string[] = [];
  walkExpression(input.expression, (node) => {
    if (node.kind === 'binary') operators.push(node.operator);
    if (node.kind === 'call' && node.name === 'fs.arrayContainsAny') {
      operators.push('arrayContainsAny');
    }
  });
  const notInCount = operators.filter((operator) => operator === 'not in').length;
  if (notInCount === 0) return;
  const forbidden = operators.some((operator) =>
    operator === 'or'
    || operator === 'in'
    || operator === 'arrayContainsAny'
    || operator === '!='
  );
  if (notInCount > 1 || forbidden) {
    input.diagnostics.push(
      firestoreError(
        'FDQL_UNSUPPORTED_FS_WHERE',
        '`not in` cannot be combined with or, in, arrayContainsAny, !=, or another not in.',
        input.line,
      ),
    );
  }
  walkExpression(input.expression, (node) => {
    if (node.kind !== 'binary' || node.operator !== 'not in') return;
    const values = staticArrayValues(node.right, input);
    if (!values) return;
    if (values.length === 0 || values.length > 10) {
      input.diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`not in` needs 1 to 10 comparison values.',
          input.line,
        ),
      );
    }
  });
}

function staticArrayValues(
  expression: FdqlExpression,
  input: FdqlProviderPredicateValidationInput,
): readonly FdqlValue[] | null {
  if (expression.kind === 'array') {
    return expression.items.map((item) => evaluateExpression(item, { aliases: input.aliases }));
  }
  if (expression.kind === 'alias') {
    const value = input.aliases[expression.name];
    return value?.kind === 'array' ? value.value : null;
  }
  return null;
}

function isFirestoreComparisonOperator(
  operator: Extract<FdqlExpression, { readonly kind: 'binary'; }>['operator'],
): boolean {
  return ['=', '!=', '<', '<=', '>', '>=', 'in', 'not in'].includes(operator);
}

function isMetadataArgument(
  expression: Extract<FdqlExpression, { readonly kind: 'field'; }>,
  parent: FdqlExpression | undefined,
): boolean {
  return parent?.kind === 'call'
    && ['fs.databaseId', 'fs.id', 'fs.parentPath', 'fs.path', 'fs.projectId', 'fs.ref'].includes(
      parent.name,
    )
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
