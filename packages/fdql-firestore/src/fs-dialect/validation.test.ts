import type { FdqlDiagnostic } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { array, binary, call, field, literal } from '../test-helpers/ast.ts';
import {
  hasBoundedIdPredicate,
  validateFirestoreAggregate,
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
    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: call(
        'fs.arrayContainsAny',
        field('d', 'tags'),
        array(literal('admin'), literal('staff')),
      ),
      line: 5,
      lookup: false,
      rowAlias: 'd',
    });
    validateFirestoreOrderBy({
      diagnostics,
      expression: call('fs.fieldPath', literal('literal.with.dot')),
      line: 6,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual([]);
    expect(
      hasBoundedIdPredicate(binary(call('fs.id', field('d')), '=', literal('drv_1')), 'd'),
    ).toBe(true);
  });

  it('accepts provider aggregate fields and rejects invalid aggregate expressions', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreAggregate({
      diagnostics,
      expression: call('fs.count'),
      functionName: 'fs.count',
      line: 7,
      rowAlias: 'r',
    });
    validateFirestoreAggregate({
      diagnostics,
      expression: call('fs.sum', field('r', 'points')),
      functionName: 'fs.sum',
      line: 8,
      rowAlias: 'r',
    });
    validateFirestoreAggregate({
      diagnostics,
      expression: call('fs.max', call('fs.fieldPath', literal('literal.with.dot'))),
      functionName: 'fs.max',
      line: 9,
      rowAlias: 'r',
    });
    validateFirestoreAggregate({
      diagnostics,
      expression: call('fs.avg', call('lower', field('r', 'name'))),
      functionName: 'fs.avg',
      line: 10,
      rowAlias: 'r',
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_FS_AGGREGATE', line: 10 }),
    ]);
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

  it('accepts native null and not-in predicates', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(
        binary(field('d', 'status'), 'not in', array(literal('deleted'), literal('archived'))),
        'and',
        { expression: field('d', 'deletedAt'), kind: 'postfix', operator: 'is null' },
      ),
      line: 3,
      lookup: false,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual([]);
  });

  it('rejects invalid native not-in combinations', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(
        binary(field('d', 'status'), 'not in', array(literal('deleted'))),
        'or',
        call('fs.arrayContainsAny', field('d', 'tags'), array(literal('admin'))),
      ),
      line: 3,
      lookup: false,
      rowAlias: 'd',
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FDQL_UNSUPPORTED_FS_WHERE',
        message:
          '`not in` cannot be combined with or, in, arrayContainsAny, !=, or another not in.',
      }),
    );
  });

  it('rejects invalid native not-in value counts', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: binary(field('d', 'status'), 'not in', array()),
      line: 3,
      lookup: false,
      rowAlias: 'd',
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FDQL_UNSUPPORTED_FS_WHERE',
        message: '`not in` needs 1 to 10 comparison values.',
      }),
    );
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
    validateFirestoreWhere({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      expression: { expression: field('d', 'deletedAt'), kind: 'postfix', operator: 'is missing' },
      line: 6,
      lookup: false,
      rowAlias: 'd',
    });
    validateFirestoreOrderBy({
      diagnostics,
      expression: call('lower', field('d', 'firstName')),
      line: 7,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE', line: 3 }),
        expect.objectContaining({ code: 'FDQL_UNQUALIFIED_PROVIDER_FIELD', line: 4 }),
        expect.objectContaining({ code: 'FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE', line: 6 }),
        expect.objectContaining({ code: 'FDQL_UNSUPPORTED_FS_ORDER_BY', line: 7 }),
      ]),
    );
  });
});
