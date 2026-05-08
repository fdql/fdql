import type { FdqlExpression, FdqlProviderRow, FdqlProviderSource } from '@firebase-desk/fdql-core';
import { arrayValue, booleanValue, missingValue, stringValue } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { field, literal } from '../test-helpers/ast.ts';
import { evaluateFirestoreCall } from './functions.ts';

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

describe('Firestore FDQL functions', () => {
  it('evaluates metadata helpers', () => {
    expect(evaluate('fs.id', field('d'))).toEqual(stringValue('drv_1'));
    expect(evaluate('fs.path', field('d'))).toEqual(stringValue('drivers/drv_1'));
    expect(evaluate('fs.projectId', field('d'))).toEqual(stringValue('local'));
    expect(evaluate('fs.databaseId', field('d'))).toEqual(stringValue('(default)'));
    expect(evaluate('fs.parentPath', field('d'))).toEqual(stringValue('drivers'));
    expect(evaluate('fs.parentPath', field('missing'))).toEqual(missingValue);
  });

  it('evaluates field path and reference provider values', () => {
    expect(evaluate('fs.fieldPath', literal('literal.with.dot'))).toMatchObject({
      display: 'literal.with.dot',
      kind: 'providerValue',
      provider: 'fs',
      valueType: 'fieldPath',
    });
    expect(evaluate('fs.ref', field('d'))).toMatchObject({
      display: 'drivers/drv_1',
      equalityKey: 'fs:local:(default):drivers/drv_1',
      kind: 'providerValue',
      provider: 'fs',
      valueType: 'documentRef',
    });
    expect(evaluate('fs.ref', literal('drivers/drv_2'))).toMatchObject({
      display: 'drivers/drv_2',
      equalityKey: 'fs::(default):drivers/drv_2',
      kind: 'providerValue',
      provider: 'fs',
      valueType: 'documentRef',
    });
  });

  it('evaluates array contains any predicates', () => {
    expect(
      evaluateFirestoreCall({
        args: [literal('array'), literal('values')],
        context,
        evaluate(expression) {
          return expression.kind === 'literal' && expression.value === 'array'
            ? arrayValue([stringValue('admin'), stringValue('staff')])
            : arrayValue([stringValue('guest'), stringValue('staff')]);
        },
        name: 'fs.arrayContainsAny',
      }),
    ).toEqual(booleanValue(true));
  });
});

function evaluate(name: string, ...args: readonly FdqlExpression[]) {
  return evaluateFirestoreCall({
    args,
    context,
    evaluate: (expression) =>
      expression.kind === 'literal' ? stringValue(String(expression.value)) : missingValue,
    name,
  });
}
