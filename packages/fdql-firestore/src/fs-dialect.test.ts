import type { FdqlDiagnostic } from '@firebase-desk/fdql-core';
import { stringValue } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { firestoreProviderDialect } from './fs-dialect.ts';
import { aliasDeclaration, call, literal } from './test-helpers/ast.ts';

describe('Firestore FDQL dialect composer', () => {
  it('wires source, setting, validation, language, and value hooks', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    expect(firestoreProviderDialect.namespace).toBe('fs');
    expect(firestoreProviderDialect.language?.settings).toContainEqual(
      expect.objectContaining({ name: 'fs.projectId' }),
    );
    expect(
      firestoreProviderDialect.resolveSetting?.({
        diagnostics,
        key: 'projectId',
        line: 1,
        value: stringValue('local'),
      }),
    ).toEqual({ projectId: 'local' });
    expect(
      firestoreProviderDialect.resolveSourceAlias({
        aliases: {},
        declaration: aliasDeclaration('$drivers', call('fs.collection', literal('drivers'))),
        defaultProviderContext: { fs: { projectId: 'local' } },
        diagnostics,
      }),
    ).toMatchObject({
      kind: 'source',
      source: { provider: 'fs', target: { collectionPath: 'drivers', projectId: 'local' } },
    });
    expect(firestoreProviderDialect.valueFunctions.has('fs.id')).toBe(true);
    expect(diagnostics).toEqual([]);
  });
});
