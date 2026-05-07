import type {
  FdqlAliasDeclaration,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlProviderRow,
  FdqlProviderSource,
  FdqlSourceRange,
} from '@firebase-desk/fdql-core';
import { missingValue, stringValue } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { firestoreProviderDialect } from './fs-dialect.ts';

const defaultProviderContext = { fs: { projectId: 'local' } };

describe('Firestore FDQL dialect', () => {
  it('resolves collection sources with field masks', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = firestoreProviderDialect.resolveSourceAlias({
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
      fieldMask: [{ path: 'firstName' }, { path: 'teamId' }],
      kind: 'source',
      source: {
        provider: 'fs',
        sourceAlias: '$drivers',
        sourceType: 'collection',
        target: { collectionPath: 'drivers', projectId: 'local' },
      },
    });
  });

  it('resolves Firestore provider settings', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    expect(
      firestoreProviderDialect.resolveSetting?.({
        diagnostics,
        key: 'projectId',
        line: 1,
        value: stringValue('query-project'),
      }),
    ).toEqual({ projectId: 'query-project' });
    expect(
      firestoreProviderDialect.resolveSetting?.({
        diagnostics,
        key: 'databaseId',
        line: 2,
        value: stringValue('query-db'),
      }),
    ).toEqual({ databaseId: 'query-db' });

    expect(diagnostics).toEqual([]);
  });

  it('resolves project and database collection group sources', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const source = firestoreProviderDialect.resolveSourceAlias({
      aliases: { $prod: { kind: 'value', value: stringValue('prod-project') } },
      declaration: aliasDeclaration(
        '$drivers',
        call(
          'fs.project.db.collectionGroup',
          alias('$prod'),
          literal('db2'),
          literal('drivers'),
        ),
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

  it('rejects invalid collection and collection group paths', () => {
    const collectionDiagnostics: FdqlDiagnostic[] = [];
    firestoreProviderDialect.resolveSourceAlias({
      aliases: {},
      declaration: aliasDeclaration('$bad', call('fs.collection', literal('drivers/driver_1'))),
      defaultProviderContext,
      diagnostics: collectionDiagnostics,
    });

    const groupDiagnostics: FdqlDiagnostic[] = [];
    firestoreProviderDialect.resolveSourceAlias({
      aliases: {},
      declaration: aliasDeclaration('$bad', call('fs.collectionGroup', literal('drivers/events'))),
      defaultProviderContext,
      diagnostics: groupDiagnostics,
    });

    expect(collectionDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR' }),
    );
    expect(groupDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR' }),
    );
  });

  it('rejects unqualified sources without Firestore context', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    firestoreProviderDialect.resolveSourceAlias({
      aliases: {},
      declaration: aliasDeclaration('$drivers', call('fs.collection', literal('drivers'))),
      defaultProviderContext: {},
      diagnostics,
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_MISSING_PROVIDER_CONTEXT' }),
    );
  });

  it('validates Firestore where and order clauses', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const availableRowAliases = new Set(['d']);

    firestoreProviderDialect.validateWhere({
      aliases: {},
      availableRowAliases,
      diagnostics,
      expression: binary(field('d', 'active'), '=', literal(true)),
      line: 3,
      lookup: false,
      rowAlias: 'd',
    });
    firestoreProviderDialect.validateWhere({
      aliases: {},
      availableRowAliases,
      diagnostics,
      expression: call('fs.arrayContains', field('d', 'tags'), literal('admin')),
      line: 4,
      lookup: false,
      rowAlias: 'd',
    });
    firestoreProviderDialect.validateOrderBy({
      diagnostics,
      expression: field('d', 'createdAt'),
      line: 5,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual([]);
    expect(
      firestoreProviderDialect.hasBoundedPredicate?.(
        binary(call('fs.id', field('d')), '=', literal('drv_1')),
        'd',
      ),
    ).toBe(true);
  });

  it('validates correlated lookup where clauses', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    firestoreProviderDialect.validateWhere({
      aliases: {},
      availableRowAliases: new Set(['d', 'team']),
      diagnostics,
      expression: binary(call('fs.id', field('team')), '=', field('d', 'teamId')),
      line: 6,
      lookup: true,
      rowAlias: 'team',
    });

    expect(diagnostics).toEqual([]);
  });

  it('rejects local expressions and unqualified fields in provider clauses', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    firestoreProviderDialect.validateWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(call('lower', field('d', 'firstName')), '=', literal('vini')),
      line: 3,
      lookup: false,
      rowAlias: 'd',
    });
    firestoreProviderDialect.validateWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(field('active'), '=', literal(true)),
      line: 4,
      lookup: false,
      rowAlias: 'd',
    });
    firestoreProviderDialect.validateOrderBy({
      diagnostics,
      expression: call('lower', field('d', 'firstName')),
      line: 5,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE', line: 3 }),
        expect.objectContaining({ code: 'FDQL_UNQUALIFIED_PROVIDER_FIELD', line: 4 }),
        expect.objectContaining({ code: 'FDQL_UNSUPPORTED_FS_ORDER_BY', line: 5 }),
      ]),
    );
  });

  it('evaluates Firestore metadata and value helpers', () => {
    const source: FdqlProviderSource = {
      provider: 'fs',
      sourceAlias: '$drivers',
      sourceType: 'collection',
      target: { collectionPath: 'drivers', projectId: 'local' },
    };
    const row: FdqlProviderRow = {
      context: { collectionPath: 'drivers', projectId: 'local' },
      data: {},
      id: 'drv_1',
      path: 'drivers/drv_1',
      provider: 'fs',
      source,
    };
    const context = { rows: { d: row } };

    expect(
      firestoreProviderDialect.evaluateCall?.({
        args: [field('d')],
        context,
        evaluate,
        name: 'fs.id',
      }),
    ).toEqual(stringValue('drv_1'));
    expect(
      firestoreProviderDialect.evaluateCall?.({
        args: [field('d')],
        context,
        evaluate,
        name: 'fs.path',
      }),
    ).toEqual(stringValue('drivers/drv_1'));
    expect(
      firestoreProviderDialect.evaluateCall?.({
        args: [field('d')],
        context,
        evaluate,
        name: 'fs.projectId',
      }),
    ).toEqual(stringValue('local'));
    expect(
      firestoreProviderDialect.evaluateCall?.({
        args: [field('d')],
        context,
        evaluate,
        name: 'fs.ref',
      }),
    ).toMatchObject({
      display: 'drivers/drv_1',
      equalityKey: 'fs:local:(default):drivers/drv_1',
      kind: 'providerValue',
      provider: 'fs',
      valueType: 'documentRef',
    });
    expect(
      firestoreProviderDialect.evaluateCall?.({
        args: [literal('drivers/drv_2')],
        context,
        evaluate,
        name: 'fs.ref',
      }),
    ).toMatchObject({
      display: 'drivers/drv_2',
      equalityKey: 'fs::(default):drivers/drv_2',
      kind: 'providerValue',
      provider: 'fs',
      valueType: 'documentRef',
    });
  });
});

function aliasDeclaration(name: string, value: FdqlExpression): FdqlAliasDeclaration {
  return { column: 1, line: 1, name, range: range(), value };
}

function alias(name: string): FdqlExpression {
  return { kind: 'alias', name };
}

function array(...items: readonly FdqlExpression[]): FdqlExpression {
  return { items, kind: 'array' };
}

function binary(
  left: FdqlExpression,
  operator: Extract<FdqlExpression, { readonly kind: 'binary'; }>['operator'],
  right: FdqlExpression,
): FdqlExpression {
  return { kind: 'binary', left, operator, right };
}

function call(name: string, ...args: readonly FdqlExpression[]): FdqlExpression {
  return { args, kind: 'call', name };
}

function field(...path: readonly string[]): FdqlExpression {
  return { kind: 'field', path };
}

function literal(value: boolean | number | string | null): FdqlExpression {
  return { kind: 'literal', value };
}

function range(): FdqlSourceRange {
  return { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
}

function evaluate(expression: FdqlExpression) {
  return expression.kind === 'literal' ? stringValue(String(expression.value)) : missingValue;
}
