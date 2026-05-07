import type { FdqlDiagnostic } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { binary, call, field, literal } from '../test-helpers/ast.ts';
import {
  hasBoundedIdPredicate,
  validateFirestoreOrderBy,
  validateFirestoreWhere,
} from './validation.ts';

describe('Firestore FDQL validation', () => {
  it('accepts Firestore where, order, and id-bound predicates', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(field('d', 'active'), '=', literal(true)),
      line: 3,
      lookup: false,
      rowAlias: 'd',
    });
    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: call('fs.arrayContains', field('d', 'tags'), literal('admin')),
      line: 4,
      lookup: false,
      rowAlias: 'd',
    });
    validateFirestoreOrderBy({
      diagnostics,
      expression: call('fs.fieldPath', literal('literal.with.dot')),
      line: 5,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual([]);
    expect(
      hasBoundedIdPredicate(binary(call('fs.id', field('d')), '=', literal('drv_1')), 'd'),
    ).toBe(true);
  });

  it('accepts correlated lookup where clauses', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreWhere({
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

    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(call('lower', field('d', 'firstName')), '=', literal('vini')),
      line: 3,
      lookup: false,
      rowAlias: 'd',
    });
    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(field('active'), '=', literal(true)),
      line: 4,
      lookup: false,
      rowAlias: 'd',
    });
    validateFirestoreOrderBy({
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
});
