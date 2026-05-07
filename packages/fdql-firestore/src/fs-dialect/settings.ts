import { type FdqlProviderSettingResolveInput, stringScalar } from '@firebase-desk/fdql-core';
import { firestoreError } from './helpers.ts';

export function resolveFirestoreSetting(
  input: FdqlProviderSettingResolveInput,
): Readonly<Record<string, unknown>> | null {
  const value = stringScalar(input.value);
  if (input.key === 'projectId') {
    if (value) return { projectId: value };
    input.diagnostics.push(
      firestoreError('FDQL_INVALID_SET', 'Invalid value for set fs.projectId.', input.line),
    );
    return null;
  }
  if (input.key === 'databaseId') {
    if (value) return { databaseId: value };
    input.diagnostics.push(
      firestoreError('FDQL_INVALID_SET', 'Invalid value for set fs.databaseId.', input.line),
    );
    return null;
  }
  input.diagnostics.push(
    firestoreError('FDQL_UNKNOWN_SET_KEY', `Unknown set key fs.${input.key}.`, input.line),
  );
  return null;
}
