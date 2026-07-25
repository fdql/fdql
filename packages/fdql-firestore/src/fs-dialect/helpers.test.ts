import type {
  FdqlDiagnostic,
  FdqlExpression,
  FdqlProviderRow,
  FdqlProviderSourceResolveInput,
} from '@firebase-desk/fdql-core';
import { stringValue } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { aliasDeclaration, array, field, literal } from '../test-helpers/ast.ts';
import {
  evaluateAliasValue,
  firestoreError,
  isCollectionPath,
  isProviderRow,
  readStringArg,
  rowArg,
  sourceTargetString,
  stringArg,
  stringContextValue,
  validateCollectionId,
  validateDocumentPath,
  walkExpression,
} from './helpers.ts';

describe('Firestore FDQL helpers', () => {
  it('creates diagnostics and reads string values from context, aliases, and targets', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    const input = sourceInput(diagnostics);

    expect(firestoreError('FDQL_PARSE_ERROR', 'Bad source.', 4)).toEqual({
      code: 'FDQL_PARSE_ERROR',
      line: 4,
      message: 'Bad source.',
      severity: 'error',
    });
    expect(stringContextValue('project')).toBe('project');
    expect(stringContextValue('')).toBeUndefined();
    expect(sourceTargetString({ target: { collectionId: 'items' } }, 'collectionId')).toBe(
      'items',
    );
    expect(stringArg(literal('orders'), {})).toBe('orders');
    expect(stringArg({ kind: 'alias', name: '$collection' }, input.aliases)).toBe('drivers');

    expect(readStringArg(undefined, input, 'fs.collection')).toBe('');
    expect(readStringArg(literal(42), input, 'fs.collection')).toBe('');
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR' }),
      expect.objectContaining({ code: 'FDQL_PARSE_ERROR' }),
    ]);
  });

  it('validates Firestore path shapes', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateDocumentPath('orders/ord_1', diagnostics, 1);
    validateCollectionId('items', diagnostics, 1);
    validateDocumentPath('orders', diagnostics, 2);
    validateDocumentPath('orders/', diagnostics, 3);
    validateCollectionId('items/nested', diagnostics, 4);

    expect(isCollectionPath('orders')).toBe(true);
    expect(isCollectionPath('orders/ord_1/items')).toBe(true);
    expect(isCollectionPath('orders/ord_1')).toBe(false);
    expect(diagnostics).toEqual([
      expect.objectContaining({ message: 'Invalid document path orders.' }),
      expect.objectContaining({ message: 'Invalid document path orders/.' }),
      expect.objectContaining({ message: 'Subcollection name must be one collection id.' }),
    ]);
  });

  it('evaluates alias expressions into FDQL values', () => {
    const value = evaluateAliasValue(
      {
        entries: [
          { key: 'collection', value: { kind: 'alias', name: '$collection' } },
          { key: 'fields', value: array(literal('firstName'), literal('lastName')) },
        ],
        kind: 'map',
      },
      { $collection: { kind: 'value', value: stringValue('drivers') } },
    );

    expect(value).toEqual({
      kind: 'map',
      value: {
        collection: stringValue('drivers'),
        fields: {
          kind: 'array',
          value: [stringValue('firstName'), stringValue('lastName')],
        },
      },
    });
    expect(evaluateAliasValue({ kind: 'alias', name: '$missing' }, {})).toEqual({
      kind: 'missing',
    });
  });

  it('reads row arguments and identifies provider rows', () => {
    const row = providerRow();

    expect(rowArg(field('driver'), { rows: { driver: row } })).toBe(row);
    expect(rowArg(field('driver', 'firstName'), { rows: { driver: row } })).toBeUndefined();
    expect(isProviderRow(row)).toBe(true);
    expect(isProviderRow({ context: {}, data: {}, id: 'missing-provider' })).toBe(false);
  });

  it('walks expression trees with parent context', () => {
    const expression: FdqlExpression = {
      branches: [{
        condition: {
          expression: field('row', 'deletedAt'),
          kind: 'postfix',
          operator: 'is null',
        },
        value: {
          kind: 'binary',
          left: field('row', 'score'),
          operator: '+',
          right: literal(1),
        },
      }],
      kind: 'case',
    };
    const visited: string[] = [];

    walkExpression(expression, (node, parent) => {
      visited.push(`${parent?.kind ?? 'root'}>${node.kind}`);
    });

    expect(visited).toEqual([
      'root>case',
      'case>postfix',
      'postfix>field',
      'case>binary',
      'binary>field',
      'binary>literal',
    ]);
  });
});

function sourceInput(diagnostics: FdqlDiagnostic[]): FdqlProviderSourceResolveInput {
  return {
    aliases: { $collection: { kind: 'value', value: stringValue('drivers') } },
    declaration: aliasDeclaration('$drivers', literal('drivers')),
    defaultProviderContext: {},
    diagnostics,
  };
}

function providerRow(): FdqlProviderRow {
  return {
    context: { projectId: 'local' },
    data: {},
    id: 'drv_1',
    path: 'drivers/drv_1',
    provider: 'fs',
    source: {
      provider: 'fs',
      sourceAlias: '$drivers',
      sourceType: 'collection',
      target: { collectionPath: 'drivers', projectId: 'local' },
    },
  };
}
