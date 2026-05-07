import type { FdqlDiagnostic, FdqlProviderRow } from '@firebase-desk/fdql-core';
import { stringValue } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { alias, aliasDeclaration, array, call, field, literal } from '../test-helpers/ast.ts';
import {
  bindFirestoreSource,
  resolveFirestoreSourceAlias,
  resolveFirestoreSourceExpression,
} from './sources.ts';

const defaultProviderContext = { fs: { projectId: 'local' } };

describe('Firestore FDQL sources', () => {
  it('resolves collection sources with field masks', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration(
        '$drivers',
        call('fs.collection', literal('drivers'), array(literal('firstName'), literal('teamId'))),
      ),
      defaultProviderContext,
      diagnostics,
    });

    expect(diagnostics).toEqual([]);
    expect(source).toMatchObject({
      fieldMask: [{ segments: ['firstName'] }, { segments: ['teamId'] }],
      kind: 'source',
      source: {
        provider: 'fs',
        sourceAlias: '$drivers',
        sourceType: 'collection',
        target: { collectionPath: 'drivers', projectId: 'local' },
      },
    });
  });

  it('resolves project and database collection group sources', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = resolveFirestoreSourceAlias({
      aliases: { $prod: { kind: 'value', value: stringValue('prod-project') } },
      declaration: aliasDeclaration(
        '$drivers',
        call('fs.project.db.collectionGroup', alias('$prod'), literal('db2'), literal('drivers')),
      ),
      defaultProviderContext,
      diagnostics,
    });

    expect(diagnostics).toEqual([]);
    expect(source).toMatchObject({
      source: {
        provider: 'fs',
        sourceType: 'collectionGroup',
        target: { collectionGroup: 'drivers', databaseId: 'db2', projectId: 'prod-project' },
      },
    });
  });

  it('resolves static and template subcollection sources', () => {
    const staticDiagnostics: FdqlDiagnostic[] = [];
    const staticSource = resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration(
        '$items',
        call(
          'fs.subcollection',
          literal('orders/ord_1'),
          literal('items'),
          array(literal('status')),
        ),
      ),
      defaultProviderContext,
      diagnostics: staticDiagnostics,
    });

    const templateDiagnostics: FdqlDiagnostic[] = [];
    const templateSource = resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration(
        '$items',
        call('fs.subcollection', literal('items'), array(literal('status'))),
      ),
      defaultProviderContext: {},
      diagnostics: templateDiagnostics,
    });

    expect(staticDiagnostics).toEqual([]);
    expect(staticSource).toMatchObject({
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
    });
    expect(templateDiagnostics).toEqual([]);
    expect(templateSource).toMatchObject({
      binding: { kind: 'parent' },
      fieldMask: [{ segments: ['status'] }],
      source: { sourceType: 'subcollection', target: { collectionId: 'items' } },
    });
  });

  it('resolves and binds dynamic subcollection lookup sources', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = resolveFirestoreSourceExpression({
      aliases: {},
      availableRowAliases: new Set(['order']),
      defaultProviderContext,
      diagnostics,
      expression: call(
        'fs.subcollection',
        field('order'),
        literal('items'),
        array(literal('status')),
      ),
      line: 5,
      sourceAlias: 'fs.subcollection(order, "items", ["status"])',
    });
    const parent: FdqlProviderRow = {
      context: { databaseId: 'db2', projectId: 'local' },
      data: {},
      id: 'ord_1',
      path: 'orders/ord_1',
      provider: 'fs',
      source: {
        provider: 'fs',
        sourceAlias: '$orders',
        sourceType: 'collection',
        target: { collectionPath: 'orders', projectId: 'local' },
      },
    };

    const bound = source?.binding
      ? bindFirestoreSource({
        binding: source.binding,
        context: { rows: { order: parent } },
        line: 5,
        source: source.source,
      })
      : null;

    expect(diagnostics).toEqual([]);
    expect(source).toMatchObject({
      binding: { expression: expect.objectContaining({ path: ['order'] }), kind: 'parent' },
      fieldMask: [{ segments: ['status'] }],
      source: { target: { collectionId: 'items' } },
    });
    expect(bound).toMatchObject({
      kind: 'bound',
      source: {
        target: {
          collectionId: 'items',
          collectionPath: 'orders/ord_1/items',
          databaseId: 'db2',
          parentPath: 'orders/ord_1',
          projectId: 'local',
        },
      },
    });
  });

  it('rejects invalid source paths and missing Firestore context', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration('$bad', call('fs.collection', literal('drivers/driver_1'))),
      defaultProviderContext,
      diagnostics,
    });
    resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration('$bad', call('fs.collectionGroup', literal('drivers/events'))),
      defaultProviderContext,
      diagnostics,
    });
    resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration(
        '$bad',
        call('fs.subcollection', literal('orders'), literal('items')),
      ),
      defaultProviderContext,
      diagnostics,
    });
    resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration(
        '$bad',
        call('fs.subcollection', literal('orders/ord_1'), literal('items/invalid')),
      ),
      defaultProviderContext,
      diagnostics,
    });
    resolveFirestoreSourceAlias({
      aliases: {},
      declaration: aliasDeclaration('$drivers', call('fs.collection', literal('drivers'))),
      defaultProviderContext: {},
      diagnostics,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_PARSE_ERROR' }),
        expect.objectContaining({ code: 'FDQL_MISSING_PROVIDER_CONTEXT' }),
      ]),
    );
  });
});
