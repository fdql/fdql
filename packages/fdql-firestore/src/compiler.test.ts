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
          fieldMask: [{ segments: ['firstName'] }, { segments: ['lastName'] }],
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

  it('accepts static subcollection sources in from', () => {
    const result = compileFdqlRead(
      `set fs.projectId = "local"
alias $items = fs.subcollection("orders/ord_1", "items", ["status"])
from $items as item
fs limit 10
return fs.id(item), item.status`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          fieldMask: [{ segments: ['status'] }],
          source: {
            sourceType: 'subcollection',
            target: {
              collectionId: 'items',
              collectionPath: 'orders/ord_1/items',
              parentPath: 'orders/ord_1',
              projectId: 'local',
            },
          },
        },
      },
    });
  });

  it('plans dynamic and template subcollection lookups', () => {
    const result = compileFdqlRead(
      `set fs.projectId = "local"
alias $orders = fs.collection("orders", [])
alias $items = fs.subcollection("items", ["status"])
from $orders as order
fs limit 1
then lookup many fs.subcollection(order, "items", ["status"]) as inlineItem
  fs limit 1
then lookup many $items of order as templateItem
  fs limit 1
return fs.id(order), inlineItem, templateItem`,
      { providers: [firestoreProviderDialect] },
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    if (!result.ok || result.plan.kind !== 'read') throw new Error('expected read plan');
    expect(result.plan.localStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'lookup',
          provider: expect.objectContaining({
            binding: { expression: expect.objectContaining({ path: ['order'] }), kind: 'parent' },
            fieldMask: [{ segments: ['status'] }],
            source: expect.objectContaining({ target: { collectionId: 'items' } }),
          }),
          rowAlias: 'inlineItem',
        }),
        expect.objectContaining({
          kind: 'lookup',
          provider: expect.objectContaining({
            binding: { expression: expect.objectContaining({ path: ['order'] }), kind: 'parent' },
            fieldMask: [{ segments: ['status'] }],
            source: expect.objectContaining({ target: { collectionId: 'items' } }),
          }),
          rowAlias: 'templateItem',
        }),
      ]),
    );
  });

  it('rejects template subcollection aliases in from and malformed parents', () => {
    const templateFrom = compileFdqlRead(
      `set fs.projectId = "local"
alias $items = fs.subcollection("items", ["status"])
from $items as item
fs limit 1
return item.status`,
      { providers: [firestoreProviderDialect] },
    );

    const missingOf = compileFdqlRead(
      `set fs.projectId = "local"
alias $orders = fs.collection("orders")
alias $items = fs.subcollection("items")
from $orders as order
fs limit 1
then lookup many $items as item
return item.status`,
      { providers: [firestoreProviderDialect] },
    );

    const invalidOf = compileFdqlRead(
      `set fs.projectId = "local"
alias $orders = fs.collection("orders")
alias $teams = fs.collection("teams")
from $orders as order
fs limit 1
then lookup many $teams of order as team
return team.name`,
      { providers: [firestoreProviderDialect] },
    );
    const dynamicFrom = compileFdqlRead(
      `set fs.projectId = "local"
alias $items = fs.subcollection(order, "items", ["status"])
from $items as item
fs limit 1
return item.status`,
      { providers: [firestoreProviderDialect] },
    );

    expect(templateFrom.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_FROM_SOURCE' }),
    );
    expect(missingOf.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_PARENT' }),
    );
    expect(invalidOf.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_PARENT' }),
    );
    expect(dynamicFrom.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_LOOKUP_PARENT' }),
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
