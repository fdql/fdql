import {
  arrayValue,
  type FdqlDiagnostic,
  numberValue,
  stringValue,
} from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { alias, array, binary, call, field, literal } from '../test-helpers/ast.ts';
import { validateFirestoreQueryConstraints } from './query-constraints.ts';

describe('Firestore FDQL query constraints', () => {
  it('accepts supported native operator shapes and inequality ordering', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreQueryConstraints({
      aliases: {
        $statuses: arrayValue([stringValue('active'), stringValue('pending')]),
      },
      availableRowAliases: new Set(['d']),
      diagnostics,
      lookup: false,
      orderBy: { direction: 'desc', expression: field('d', 'createdAt') },
      orderByLine: 5,
      predicate: binary(
        binary(field('d', 'status'), 'in', alias('$statuses')),
        'and',
        binary(field('d', 'createdAt'), '>=', literal('2026-01-01T00:00:00.000Z')),
      ),
      predicateLine: 3,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual([]);
  });

  it('rejects invalid static array value shapes', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreQueryConstraints({
      aliases: {
        $scalar: numberValue(1),
        $tooMany: arrayValue(Array.from({ length: 31 }, (_unused, index) => numberValue(index))),
      },
      availableRowAliases: new Set(['d']),
      diagnostics,
      lookup: false,
      predicate: binary(
        binary(field('d', 'status'), 'in', array()),
        'and',
        binary(
          call('fs.arrayContainsAny', field('d', 'tags'), alias('$tooMany')),
          'and',
          binary(field('d', 'region'), 'not in', alias('$scalar')),
        ),
      ),
      predicateLine: 4,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FDQL_UNSUPPORTED_FS_WHERE',
          message: '`in` needs 1 to 30 comparison values.',
        }),
        expect.objectContaining({
          code: 'FDQL_UNSUPPORTED_FS_WHERE',
          message: 'arrayContainsAny needs 1 to 30 comparison values.',
        }),
        expect.objectContaining({
          code: 'FDQL_UNSUPPORTED_FS_WHERE',
          message: '`not in` needs 1 to 10 comparison values.',
        }),
      ]),
    );
  });

  it('rejects invalid not-in and negative filter combinations', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreQueryConstraints({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      lookup: false,
      predicate: binary(
        binary(field('d', 'status'), 'not in', array(literal('deleted'))),
        'or',
        { expression: field('d', 'deletedAt'), kind: 'postfix', operator: 'is not null' },
      ),
      predicateLine: 6,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FDQL_UNSUPPORTED_FS_WHERE',
          message:
            '`not in` cannot be combined with or, in, arrayContainsAny, !=, is not null, or another not in.',
        }),
        expect.objectContaining({
          code: 'FDQL_UNSUPPORTED_FS_WHERE',
          message: 'Firestore supports only one negative filter: !=, not in, or is not null.',
        }),
      ]),
    );
  });

  it('rejects array operator conflicts in the same disjunction', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreQueryConstraints({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      lookup: false,
      predicate: binary(
        call('fs.arrayContains', field('d', 'tags'), literal('admin')),
        'and',
        call('fs.arrayContainsAny', field('d', 'tags'), array(literal('staff'))),
      ),
      predicateLine: 3,
      rowAlias: 'd',
    });
    validateFirestoreQueryConstraints({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      lookup: false,
      predicate: binary(
        call('fs.arrayContainsAny', field('d', 'tags'), array(literal('admin'))),
        'and',
        call('fs.arrayContainsAny', field('d', 'roles'), array(literal('owner'))),
      ),
      predicateLine: 8,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FDQL_UNSUPPORTED_FS_WHERE',
          message:
            'Firestore cannot combine arrayContains and arrayContainsAny in the same disjunction.',
        }),
        expect.objectContaining({
          code: 'FDQL_UNSUPPORTED_FS_WHERE',
          message: 'Firestore supports only one arrayContainsAny filter in the same disjunction.',
        }),
      ]),
    );
  });

  it('rejects order by fields that do not match inequality filters', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreQueryConstraints({
      aliases: {},
      availableRowAliases: new Set(['d']),
      diagnostics,
      lookup: false,
      orderBy: { direction: 'asc', expression: field('d', 'name') },
      orderByLine: 7,
      predicate: binary(field('d', 'createdAt'), '>=', literal('2026-01-01T00:00:00.000Z')),
      predicateLine: 4,
      rowAlias: 'd',
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_FS_ORDER_BY', line: 7 }),
    ]);
  });

  it('skips static value checks for dynamic lookup values', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    validateFirestoreQueryConstraints({
      aliases: {},
      availableRowAliases: new Set(['d', 'team']),
      diagnostics,
      lookup: true,
      predicate: binary(call('fs.id', field('team')), 'in', field('d', 'teamIds')),
      predicateLine: 5,
      rowAlias: 'team',
    });

    expect(diagnostics).toEqual([]);
  });
});
