import { compileFdqlRead } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { firestoreProviderDialect } from './fs-dialect.ts';

describe('Firestore FDQL compiler integration', () => {
  it('plans Firestore collection reads with project, database, where, order, and metadata calls', () => {
    const result = compileFdqlRead(
      `set fs.projectId = "default"
set fs.databaseId = "default-db"
alias $drivers = fs.project("prod").db("db2").collection("drivers", ["firstName", "lastName"])
from $drivers as d
fs where fs.id(d) = "drv_1"
fs order by d.createdAt desc
fs limit 25
return fs.id(d) as id, fs.path(d) as path, d.firstName`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          fieldMask: [{ path: 'firstName' }, { path: 'lastName' }],
          limit: 25,
          orderBy: { direction: 'desc' },
          source: {
            provider: 'fs',
            sourceType: 'collection',
            target: { collectionPath: 'drivers', databaseId: 'db2', projectId: 'prod' },
          },
        },
      },
    });
  });

  it('requires Firestore project context for unqualified sources', () => {
    const result = compileFdqlRead(
      `alias $drivers = fs.collection("drivers")
from $drivers as d
fs limit 1
return d.firstName`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_MISSING_PROVIDER_CONTEXT' }),
    );
  });

  it('rejects Firestore provider filters that cannot compile', () => {
    const result = compileFdqlRead(
      `set fs.projectId = "local"
alias $drivers = fs.collection("drivers")
from $drivers as d
fs where "paid" = d.status
fs limit 1
return d.firstName`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_FS_WHERE' }),
    );
  });
});
