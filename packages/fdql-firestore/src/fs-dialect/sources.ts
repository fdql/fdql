import {
  type FdqlDiagnostic,
  type FdqlExpression,
  type FdqlProviderSourceAlias,
  type FdqlProviderSourceBindInput,
  type FdqlProviderSourceBindResult,
  type FdqlProviderSourceExpressionResolveInput,
  type FdqlProviderSourceResolveInput,
  providerContextValue,
} from '@firebase-desk/fdql-core';
import { readFieldMask } from './field-mask.ts';
import {
  firestoreError,
  isCollectionPath,
  isProviderRow,
  readStringArg,
  sourceTargetString,
  stringArg,
  stringContextValue,
  validateCollectionId,
  validateDocumentPath,
} from './helpers.ts';

export function resolveFirestoreSourceAlias(
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
          firestoreError('FDQL_PARSE_ERROR', `Invalid collection path ${path}.`, declaration.line),
        );
      }
      if (part === 'collectionGroup' && path.includes('/')) {
        diagnostics.push(
          firestoreError(
            'FDQL_PARSE_ERROR',
            'fs.collectionGroup accepts a collection id, not a path.',
            declaration.line,
          ),
        );
      }
      if (!projectId) {
        diagnostics.push(missingProviderContext(declaration.line));
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
    if (part === 'subcollection') {
      source = readSubcollectionSource({
        args,
        databaseId,
        diagnostics,
        line: declaration.line,
        projectId,
        sourceAlias: declaration.name,
        availableRowAliases: input.availableRowAliases ?? new Set(),
        aliases: input.aliases,
      });
      args.length = 0;
      continue;
    }
    diagnostics.push(
      firestoreError(
        'FDQL_UNKNOWN_NAMESPACE',
        `Unknown fs source function ${part}.`,
        declaration.line,
      ),
    );
  }

  if (args.length) {
    diagnostics.push(
      firestoreError(
        'FDQL_PARSE_ERROR',
        `Too many arguments for ${declaration.value.name}.`,
        declaration.line,
      ),
    );
  }
  return source;
}

export function resolveFirestoreSourceExpression(
  input: FdqlProviderSourceExpressionResolveInput,
): FdqlProviderSourceAlias | null {
  if (input.expression.kind !== 'call' || input.expression.name !== 'fs.subcollection') {
    input.diagnostics.push(
      firestoreError(
        'FDQL_INVALID_LOOKUP_SOURCE',
        'Firestore inline lookup sources must use fs.subcollection(...).',
        input.line,
      ),
    );
    return null;
  }
  return readSubcollectionSource({
    args: [...input.expression.args],
    databaseId: stringContextValue(input.defaultProviderContext['fs']?.['databaseId']),
    diagnostics: input.diagnostics,
    line: input.line,
    projectId: stringContextValue(input.defaultProviderContext['fs']?.['projectId']),
    sourceAlias: input.sourceAlias,
    availableRowAliases: input.availableRowAliases,
    aliases: input.aliases,
  });
}

export function bindFirestoreSource(
  input: FdqlProviderSourceBindInput,
): FdqlProviderSourceBindResult {
  if (input.source.sourceType !== 'subcollection') return { kind: 'bound', source: input.source };
  const row = input.binding.expression
    ? input.context.rows?.[
      input.binding.expression.kind === 'field'
        ? input.binding.expression.path[0] ?? ''
        : ''
    ]
    : undefined;
  if (row === null || row === undefined) return { kind: 'skip' };
  if (!isProviderRow(row) || row.provider !== 'fs') {
    return {
      diagnostic: firestoreError(
        'FDQL_INVALID_LOOKUP_PARENT',
        'Subcollection parent must be a Firestore row.',
        input.line,
      ),
      kind: 'failed',
    };
  }
  const collectionId = sourceTargetString(input.source, 'collectionId');
  if (!collectionId) {
    return {
      diagnostic: firestoreError(
        'FDQL_PARSE_ERROR',
        'Subcollection source is missing a collection name.',
        input.line,
      ),
      kind: 'failed',
    };
  }
  const databaseId = providerContextValue(row, 'databaseId');
  const projectId = providerContextValue(row, 'projectId');
  const collectionPath = `${row.path}/${collectionId}`;
  return {
    kind: 'bound',
    source: {
      ...input.source,
      target: {
        ...input.source.target,
        collectionPath,
        parentPath: row.path,
        ...(typeof databaseId === 'string' ? { databaseId } : {}),
        ...(typeof projectId === 'string' ? { projectId } : {}),
      },
    },
  };
}

interface ReadSubcollectionSourceInput {
  readonly aliases: FdqlProviderSourceResolveInput['aliases'];
  readonly args: FdqlExpression[];
  readonly availableRowAliases: ReadonlySet<string>;
  readonly databaseId: string | undefined;
  readonly diagnostics: FdqlDiagnostic[];
  readonly line: number;
  readonly projectId: string | undefined;
  readonly sourceAlias: string;
}

function readSubcollectionSource(input: ReadSubcollectionSourceInput): FdqlProviderSourceAlias {
  const [first, second, third, ...extra] = input.args;
  if (extra.length || !first) {
    input.diagnostics.push(
      firestoreError(
        'FDQL_PARSE_ERROR',
        'fs.subcollection needs (name, fields?), (parentPath, name, fields?), or (parent, name, fields?).',
        input.line,
      ),
    );
  }
  const firstString = stringArg(first, input.aliases);
  const secondString = second ? stringArg(second, input.aliases) : undefined;
  if (firstString && secondString) {
    return staticSubcollectionSource(input, firstString, secondString, third);
  }
  if (firstString) {
    return templateSubcollectionSource(input, firstString, second);
  }
  return dynamicSubcollectionSource(input, first, second, third);
}

function staticSubcollectionSource(
  input: ReadSubcollectionSourceInput,
  parentPath: string,
  collectionId: string,
  fieldMaskExpression: FdqlExpression | undefined,
): FdqlProviderSourceAlias {
  validateDocumentPath(parentPath, input.diagnostics, input.line);
  validateCollectionId(collectionId, input.diagnostics, input.line);
  if (!input.projectId) {
    input.diagnostics.push(missingProviderContext(input.line));
  }
  const fieldMask = fieldMaskExpression
    ? readFieldMask(fieldMaskExpression, input.diagnostics, input.line)
    : undefined;
  return {
    ...(fieldMask === undefined ? {} : { fieldMask }),
    kind: 'source',
    source: {
      provider: 'fs',
      sourceAlias: input.sourceAlias,
      sourceType: 'subcollection',
      target: {
        ...(input.databaseId ? { databaseId: input.databaseId } : {}),
        collectionId,
        collectionPath: `${parentPath}/${collectionId}`,
        parentPath,
        projectId: input.projectId ?? '',
      },
    },
  };
}

function templateSubcollectionSource(
  input: ReadSubcollectionSourceInput,
  collectionId: string,
  fieldMaskExpression: FdqlExpression | undefined,
): FdqlProviderSourceAlias {
  validateCollectionId(collectionId, input.diagnostics, input.line);
  const fieldMask = fieldMaskExpression
    ? readFieldMask(fieldMaskExpression, input.diagnostics, input.line)
    : undefined;
  return {
    binding: { kind: 'parent' },
    ...(fieldMask === undefined ? {} : { fieldMask }),
    kind: 'source',
    source: {
      provider: 'fs',
      sourceAlias: input.sourceAlias,
      sourceType: 'subcollection',
      target: {
        collectionId,
      },
    },
  };
}

function dynamicSubcollectionSource(
  input: ReadSubcollectionSourceInput,
  parentExpression: FdqlExpression | undefined,
  collectionExpression: FdqlExpression | undefined,
  fieldMaskExpression: FdqlExpression | undefined,
): FdqlProviderSourceAlias {
  const collectionId = collectionExpression ? stringArg(collectionExpression, input.aliases) : '';
  if (!collectionId) {
    input.diagnostics.push(
      firestoreError(
        'FDQL_PARSE_ERROR',
        'fs.subcollection parent form needs a collection name.',
        input.line,
      ),
    );
  } else {
    validateCollectionId(collectionId, input.diagnostics, input.line);
  }
  if (
    !parentExpression || parentExpression.kind !== 'field' || parentExpression.path.length !== 1
    || !input.availableRowAliases.has(parentExpression.path[0] ?? '')
  ) {
    input.diagnostics.push(
      firestoreError(
        'FDQL_INVALID_LOOKUP_PARENT',
        'Subcollection parent must be an existing provider row alias.',
        input.line,
      ),
    );
  }
  const fieldMask = fieldMaskExpression
    ? readFieldMask(fieldMaskExpression, input.diagnostics, input.line)
    : undefined;
  return {
    binding: parentExpression
      ? { expression: parentExpression, kind: 'parent' }
      : { kind: 'parent' },
    ...(fieldMask === undefined ? {} : { fieldMask }),
    kind: 'source',
    source: {
      provider: 'fs',
      sourceAlias: input.sourceAlias,
      sourceType: 'subcollection',
      target: {
        collectionId,
      },
    },
  };
}

function missingProviderContext(line: number): FdqlDiagnostic {
  return firestoreError(
    'FDQL_MISSING_PROVIDER_CONTEXT',
    'fs source needs fs.project(...), set fs.projectId, or defaultProviderContext.fs.projectId.',
    line,
  );
}
