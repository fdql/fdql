import {
  arrayValue,
  booleanValue,
  equalValues,
  type FdqlProviderCallEvaluationInput,
  type FdqlProviderRow,
  type FdqlValue,
  missingValue,
  providerContextValue,
  providerValue,
  stringScalar,
  stringValue,
} from '@firebase-desk/fdql-core';
import { isProviderRow, rowArg } from './helpers.ts';

export const firestoreValueFunctions = new Set([
  'fs.arrayContains',
  'fs.arrayContainsAny',
  'fs.databaseId',
  'fs.fieldPath',
  'fs.id',
  'fs.parentPath',
  'fs.path',
  'fs.projectId',
  'fs.ref',
]);

export function evaluateFirestoreCall(input: FdqlProviderCallEvaluationInput): FdqlValue {
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
  if (input.name === 'fs.databaseId') {
    const row = rowArg(input.args[0], input.context);
    if (!isProviderRow(row)) return missingValue;
    const databaseId = providerContextValue(row, 'databaseId');
    return stringValue(typeof databaseId === 'string' ? databaseId : '(default)');
  }
  if (input.name === 'fs.parentPath') {
    const row = rowArg(input.args[0], input.context);
    return isProviderRow(row)
      ? stringValue(row.path.split('/').slice(0, -1).join('/'))
      : missingValue;
  }
  if (input.name === 'fs.ref') {
    const row = rowArg(input.args[0], input.context);
    if (isProviderRow(row)) return documentRefValue(row.path, row);
    const path = stringScalar(input.evaluate(input.args[0]!, input.context));
    return path ? documentRefValue(path) : missingValue;
  }
  if (input.name === 'fs.fieldPath') {
    const segments = input.args.flatMap((arg) => {
      const segment = stringScalar(input.evaluate(arg, input.context));
      return segment ? [segment] : [];
    });
    return providerValue({
      display: segments.join('.'),
      equalityKey: `fs:fieldPath:${JSON.stringify(segments)}`,
      provider: 'fs',
      value: { segments: arrayValue(segments.map(stringValue)) },
      valueType: 'fieldPath',
    });
  }
  if (input.name === 'fs.arrayContains') {
    const array = input.evaluate(input.args[0]!, input.context);
    const value = input.evaluate(input.args[1]!, input.context);
    return booleanValue(
      array.kind === 'array' && array.value.some((item) => equalValues(item, value)),
    );
  }
  if (input.name === 'fs.arrayContainsAny') {
    const array = input.evaluate(input.args[0]!, input.context);
    const values = input.evaluate(input.args[1]!, input.context);
    return booleanValue(
      array.kind === 'array'
        && values.kind === 'array'
        && values.value.some((value) => array.value.some((item) => equalValues(item, value))),
    );
  }
  return missingValue;
}

export function documentRefValue(path: string, row?: FdqlProviderRow | undefined): FdqlValue {
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
