import {
  arrayValue,
  booleanValue,
  equalValues,
  evaluateExpression,
  type FdqlDiagnostic,
  type FdqlExpression,
  type FdqlFieldMaskField,
  type FdqlProviderDialect,
  type FdqlProviderEvaluationContext,
  type FdqlProviderOrderByValidationInput,
  type FdqlProviderPredicateValidationInput,
  type FdqlProviderRow,
  type FdqlProviderSettingResolveInput,
  type FdqlProviderSourceAlias,
  type FdqlProviderSourceResolveInput,
  type FdqlValue,
  literalToValue,
  mapValue,
  missingValue,
  providerContextValue,
  providerValue,
  stringScalar,
  stringValue,
} from '@firebase-desk/fdql-core';

export const firestoreProviderDialect: FdqlProviderDialect = {
  language: {
    clauses: [
      {
        detail: 'Firestore provider filter',
        insertText: 'fs where ${1:field} = ${2:value}',
        keyword: 'where',
        label: 'fs where',
      },
      {
        detail: 'Firestore provider ordering',
        insertText: 'fs order by ${1:field} ${2|asc,desc|}',
        keyword: 'order by',
        label: 'fs order by',
      },
      {
        detail: 'Firestore provider limit',
        insertText: 'fs limit ${1:25}',
        keyword: 'limit',
        label: 'fs limit',
      },
    ],
    settings: [
      {
        detail: 'Default Firestore project id',
        insertText: 'set fs.projectId = "${1:project-id}"',
        name: 'fs.projectId',
      },
      {
        detail: 'Default Firestore database id',
        insertText: 'set fs.databaseId = "${1:database-id}"',
        name: 'fs.databaseId',
      },
    ],
    sourceFunctions: [
      {
        detail: 'Firestore collection source',
        insertText: 'fs.collection("${1:collection}")',
        name: 'fs.collection',
      },
      {
        detail: 'Firestore collection group source',
        insertText: 'fs.collectionGroup("${1:collectionId}")',
        name: 'fs.collectionGroup',
      },
      {
        detail: 'Firestore project selector',
        insertText: 'fs.project("${1:project-id}")',
        name: 'fs.project',
      },
      {
        detail: 'Firestore database selector',
        insertText: 'fs.db("${1:database-id}")',
        name: 'fs.db',
      },
    ],
    valueFunctions: [
      {
        detail: 'Document id for a Firestore row',
        insertText: 'fs.id(${1:row})',
        name: 'fs.id',
      },
      {
        detail: 'Document path for a Firestore row',
        insertText: 'fs.path(${1:row})',
        name: 'fs.path',
      },
      {
        detail: 'Project id for a Firestore row',
        insertText: 'fs.projectId(${1:row})',
        name: 'fs.projectId',
      },
      {
        detail: 'Firestore document reference value',
        insertText: 'fs.ref(${1:rowOrPath})',
        name: 'fs.ref',
      },
      {
        detail: 'Firestore array-contains predicate',
        insertText: 'fs.arrayContains(${1:field}, ${2:value})',
        name: 'fs.arrayContains',
      },
    ],
  },
  namespace: 'fs',
  sourceFunctions: new Set(['collection', 'collectionGroup', 'db', 'project']),
  valueFunctions: new Set(['fs.arrayContains', 'fs.id', 'fs.path', 'fs.projectId', 'fs.ref']),
  evaluateCall(input) {
    if (input.name === 'fs.id') {
      const row = rowArg(input.args[0], input.context);
      return isProviderRow(row) ? stringValue(row.id) : missingValue;
    }
    if (input.name === 'fs.path') {
      const row = rowArg(input.args[0], input.context);
      return isProviderRow(row) ? stringValue(row.path) : missingValue;
    }
    if (input.name === 'fs.projectId') {
      const row = rowArg(input.args[0], input.context);
      const projectId = isProviderRow(row) ? providerContextValue(row, 'projectId') : undefined;
      return typeof projectId === 'string' ? stringValue(projectId) : missingValue;
    }
    if (input.name === 'fs.ref') {
      const row = rowArg(input.args[0], input.context);
      if (isProviderRow(row)) return documentRefValue(row.path, row);
      const path = stringScalar(input.evaluate(input.args[0]!, input.context));
      return path ? documentRefValue(path) : missingValue;
    }
    if (input.name === 'fs.arrayContains') {
      const array = input.evaluate(input.args[0]!, input.context);
      const value = input.evaluate(input.args[1]!, input.context);
      return booleanValue(
        array.kind === 'array' && array.value.some((item) => equalValues(item, value)),
      );
    }
    return missingValue;
  },
  hasBoundedPredicate: hasBoundedIdPredicate,
  resolveSourceAlias(input) {
    return resolveFirestoreSourceAlias(input);
  },
  resolveSetting(input) {
    return resolveFirestoreSetting(input);
  },
  validateOrderBy(input) {
    validateFirestoreOrderBy(input);
  },
  validateWhere(input) {
    validateFirestoreWhere(input);
  },
};

function resolveFirestoreSourceAlias(
  input: FdqlProviderSourceResolveInput,
): FdqlProviderSourceAlias | null {
  const { declaration, diagnostics } = input;
  if (declaration.value.kind !== 'call' || !declaration.value.name.startsWith('fs.')) return null;
  const parts = declaration.value.name.split('.').slice(1);
  const args = [...declaration.value.args];
  let projectId = stringContextValue(input.defaultProviderContext['fs']?.['projectId']);
  let databaseId = stringContextValue(input.defaultProviderContext['fs']?.['databaseId']);
  let source: FdqlProviderSourceAlias | null = null;

  for (const part of parts) {
    if (part === 'project') {
      projectId = readStringArg(args.shift(), input, 'fs.project');
      continue;
    }
    if (part === 'db') {
      databaseId = readStringArg(args.shift(), input, 'fs.db');
      continue;
    }
    if (part === 'collection' || part === 'collectionGroup') {
      const path = readStringArg(args.shift(), input, `fs.${part}`);
      const fieldMask = args.length
        ? readFieldMask(args.shift(), diagnostics, declaration.line)
        : undefined;
      if (part === 'collection' && !isCollectionPath(path)) {
        diagnostics.push(
          error('FDQL_PARSE_ERROR', `Invalid collection path ${path}.`, declaration.line),
        );
      }
      if (part === 'collectionGroup' && path.includes('/')) {
        diagnostics.push(
          error(
            'FDQL_PARSE_ERROR',
            'fs.collectionGroup accepts a collection id, not a path.',
            declaration.line,
          ),
        );
      }
      if (!projectId) {
        diagnostics.push(
          error(
            'FDQL_MISSING_PROVIDER_CONTEXT',
            'fs source needs fs.project(...), set fs.projectId, or defaultProviderContext.fs.projectId.',
            declaration.line,
          ),
        );
      }
      source = {
        ...(fieldMask === undefined ? {} : { fieldMask }),
        kind: 'source',
        source: {
          provider: 'fs',
          sourceAlias: declaration.name,
          sourceType: part,
          target: {
            ...(databaseId ? { databaseId } : {}),
            ...(part === 'collection' ? { collectionPath: path } : { collectionGroup: path }),
            projectId: projectId ?? '',
          },
        },
      };
      continue;
    }
    diagnostics.push(
      error('FDQL_UNKNOWN_NAMESPACE', `Unknown fs source function ${part}.`, declaration.line),
    );
  }

  if (args.length) {
    diagnostics.push(
      error(
        'FDQL_PARSE_ERROR',
        `Too many arguments for ${declaration.value.name}.`,
        declaration.line,
      ),
    );
  }
  return source;
}

function resolveFirestoreSetting(
  input: FdqlProviderSettingResolveInput,
): Readonly<Record<string, unknown>> | null {
  const value = stringScalar(input.value);
  if (input.key === 'projectId') {
    if (value) return { projectId: value };
    input.diagnostics.push(
      error('FDQL_INVALID_SET', 'Invalid value for set fs.projectId.', input.line),
    );
    return null;
  }
  if (input.key === 'databaseId') {
    if (value) return { databaseId: value };
    input.diagnostics.push(
      error('FDQL_INVALID_SET', 'Invalid value for set fs.databaseId.', input.line),
    );
    return null;
  }
  input.diagnostics.push(
    error('FDQL_UNKNOWN_SET_KEY', `Unknown set key fs.${input.key}.`, input.line),
  );
  return null;
}

function stringContextValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function validateFirestoreWhere(input: FdqlProviderPredicateValidationInput): void {
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
      && !['bytes', 'fs.id', 'fs.ref', 'fs.arrayContains', 'geoPoint', 'timestamp'].includes(
        node.name,
      )
    ) {
      input.diagnostics.push(
        error(
          'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE',
          `${node.name} is not valid in ${input.lookup ? 'lookup ' : ''}fs where.`,
          input.line,
        ),
      );
    }
    if (node.kind === 'field' && !isMetadataArgument(node, parent)) {
      const binding = node.path[0];
      if (node.path.length === 1) {
        validateProviderField(node.path, input.rowAlias, input.diagnostics, input.line);
      } else if (!binding || !input.availableRowAliases.has(binding)) {
        input.diagnostics.push(
          error('FDQL_UNKNOWN_BINDING', `Unknown row binding ${binding}.`, input.line),
        );
      } else if (binding === input.rowAlias) {
        validateProviderField(node.path, input.rowAlias, input.diagnostics, input.line);
      }
    }
  });
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
        error(
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
        error(
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
        error(
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
        error(
          'FDQL_UNSUPPORTED_FS_WHERE',
          '`fs.arrayContains` needs a provider field and a provider value.',
          line,
        ),
      );
    }
    return;
  }
  diagnostics.push(
    error(
      'FDQL_UNSUPPORTED_FS_WHERE',
      lookup
        ? '`lookup` fs where needs provider predicates.'
        : '`fs where` needs provider comparison predicates.',
      line,
    ),
  );
}

function validateFirestoreOrderBy(input: FdqlProviderOrderByValidationInput): void {
  if (input.expression.kind === 'field') {
    validateProviderField(input.expression.path, input.rowAlias, input.diagnostics, input.line);
    return;
  }
  if (input.expression.kind === 'call' && input.expression.name === 'fs.id') return;
  input.diagnostics.push(
    error('FDQL_UNSUPPORTED_FS_ORDER_BY', '`fs order by` needs a provider field.', input.line),
  );
}

function readStringArg(
  expression: FdqlExpression | undefined,
  input: FdqlProviderSourceResolveInput,
  functionName: string,
): string {
  if (!expression) {
    input.diagnostics.push(
      error('FDQL_PARSE_ERROR', `${functionName} needs a string argument.`, input.declaration.line),
    );
    return '';
  }
  const value = evaluateAliasValue(expression, input.aliases);
  const text = stringScalar(value);
  if (text === undefined) {
    input.diagnostics.push(
      error('FDQL_PARSE_ERROR', `${functionName} needs a string argument.`, input.declaration.line),
    );
    return '';
  }
  return text;
}

function readFieldMask(
  expression: FdqlExpression | undefined,
  diagnostics: FdqlDiagnostic[],
  line: number,
): readonly FdqlFieldMaskField[] | undefined {
  if (!expression) return undefined;
  if (expression.kind !== 'array') {
    diagnostics.push(
      error(
        'FDQL_INVALID_FIELD_MASK',
        'Top-level source field masks must be literal arrays.',
        line,
      ),
    );
    return undefined;
  }
  if (expression.items.length > 150) {
    diagnostics.push(
      error('FDQL_INVALID_FIELD_MASK', 'Field masks can include at most 150 fields.', line),
    );
  }
  return expression.items.flatMap((item) => {
    if (item.kind === 'literal' && typeof item.value === 'string') return [{ path: item.value }];
    diagnostics.push(error('FDQL_INVALID_FIELD_MASK', 'Field mask entries must be strings.', line));
    return [];
  });
}

function evaluateAliasValue(
  expression: FdqlExpression,
  aliases: FdqlProviderSourceResolveInput['aliases'],
): FdqlValue {
  if (expression.kind === 'alias') {
    const value = aliases[expression.name];
    return value?.kind === 'value' ? value.value : missingValue;
  }
  if (expression.kind === 'array') {
    return arrayValue(expression.items.map((item) => evaluateAliasValue(item, aliases)));
  }
  if (expression.kind === 'map') {
    return mapValue(Object.fromEntries(
      expression.entries.map((entry) => [entry.key, evaluateAliasValue(entry.value, aliases)]),
    ));
  }
  if (expression.kind === 'literal') return literalToValue(expression.value);
  return evaluateExpression(expression, {
    providers: { fs: firestoreProviderDialect },
  });
}

function hasBoundedIdPredicate(expression: FdqlExpression | undefined, rowAlias: string): boolean {
  if (!expression) return false;
  if (expression.kind === 'binary' && expression.operator === 'and') {
    return hasBoundedIdPredicate(expression.left, rowAlias)
      || hasBoundedIdPredicate(expression.right, rowAlias);
  }
  if (expression.kind !== 'binary' || expression.operator !== '=') return false;
  return isIdCall(expression.left, rowAlias) || isIdCall(expression.right, rowAlias);
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
  return isIdCall(expression, rowAlias);
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

function documentRefValue(path: string, row?: FdqlProviderRow | undefined): FdqlValue {
  const projectId = row ? String(providerContextValue(row, 'projectId') ?? '') : '';
  const databaseId = row
    ? String(providerContextValue(row, 'databaseId') ?? '(default)')
    : '(default)';
  const equalityKey = `fs:${projectId}:${databaseId}:${path}`;
  return providerValue({
    display: path,
    equalityKey,
    provider: 'fs',
    value: {
      databaseId: stringValue(databaseId),
      path: stringValue(path),
      projectId: stringValue(projectId),
    },
    valueType: 'documentRef',
  });
}

function validateProviderField(
  path: readonly string[],
  rowAlias: string,
  diagnostics: FdqlDiagnostic[],
  line: number,
): void {
  if (path.length === 1) {
    diagnostics.push(
      error(
        'FDQL_UNQUALIFIED_PROVIDER_FIELD',
        `Provider field ${path[0]} must be qualified.`,
        line,
      ),
    );
  } else if (path[0] !== rowAlias) {
    diagnostics.push(
      error('FDQL_UNKNOWN_BINDING', `Unknown provider row binding ${path[0]}.`, line),
    );
  }
}

function rowArg(
  expression: FdqlExpression | undefined,
  context: FdqlProviderEvaluationContext,
): unknown {
  if (!expression || expression.kind !== 'field' || expression.path.length !== 1) return undefined;
  return context.rows?.[expression.path[0] ?? ''];
}

function isCollectionPath(path: string): boolean {
  return Boolean(path) && path.split('/').filter(Boolean).length % 2 === 1;
}

function isProviderRow(value: unknown): value is FdqlProviderRow {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'context' in value
    && 'data' in value
    && 'id' in value
    && 'provider' in value;
}

function walkExpression(
  expression: FdqlExpression,
  visit: (expression: FdqlExpression, parent?: FdqlExpression | undefined) => void,
  parent?: FdqlExpression,
): void {
  visit(expression, parent);
  if (expression.kind === 'array') {
    for (const item of expression.items) walkExpression(item, visit, expression);
  } else if (expression.kind === 'map') {
    for (const entry of expression.entries) walkExpression(entry.value, visit, expression);
  } else if (expression.kind === 'call') {
    for (const arg of expression.args) walkExpression(arg, visit, expression);
  } else if (expression.kind === 'unary') {
    walkExpression(expression.expression, visit, expression);
  } else if (expression.kind === 'binary') {
    walkExpression(expression.left, visit, expression);
    walkExpression(expression.right, visit, expression);
  }
}

function error(code: string, message: string, line?: number): FdqlDiagnostic {
  return { code, ...(line ? { line } : {}), message, severity: 'error' };
}
