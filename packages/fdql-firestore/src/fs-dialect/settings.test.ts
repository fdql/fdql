import type { FdqlDiagnostic } from '@firebase-desk/fdql-core';
import { numberValue, stringValue } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { resolveFirestoreSetting } from './settings.ts';

describe('Firestore FDQL settings', () => {
  it('resolves project and database defaults', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    expect(
      resolveFirestoreSetting({
        diagnostics,
        key: 'projectId',
        line: 1,
        value: stringValue('query-project'),
      }),
    ).toEqual({ projectId: 'query-project' });
    expect(
      resolveFirestoreSetting({
        diagnostics,
        key: 'databaseId',
        line: 2,
        value: stringValue('query-db'),
      }),
    ).toEqual({ databaseId: 'query-db' });
    expect(diagnostics).toEqual([]);
  });

  it('rejects invalid and unknown settings', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    resolveFirestoreSetting({ diagnostics, key: 'projectId', line: 1, value: numberValue(1) });
    resolveFirestoreSetting({ diagnostics, key: 'region', line: 2, value: stringValue('us') });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_INVALID_SET', line: 1 }),
        expect.objectContaining({ code: 'FDQL_UNKNOWN_SET_KEY', line: 2 }),
      ]),
    );
  });
});
