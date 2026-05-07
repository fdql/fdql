import type { FdqlDiagnostic } from '@firebase-desk/fdql-core';
import { describe, expect, it } from 'vitest';
import { array, call, literal } from '../test-helpers/ast.ts';
import { readFieldMask } from './field-mask.ts';

describe('Firestore FDQL field masks', () => {
  it('reads nested string paths and explicit literal dotted segments', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    expect(
      readFieldMask(
        array(literal('schedule.startsAt'), call('fs.fieldPath', literal('literal.with.dot'))),
        diagnostics,
        1,
      ),
    ).toEqual([
      { segments: ['schedule', 'startsAt'] },
      { segments: ['literal.with.dot'] },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('rejects non-array masks, invalid field paths, and masks above 150 fields', () => {
    const diagnostics: FdqlDiagnostic[] = [];

    readFieldMask(literal('name'), diagnostics, 1);
    readFieldMask(array(literal('')), diagnostics, 2);
    readFieldMask(
      array(...Array.from({ length: 151 }, (_, index) => literal(`f${index}`))),
      diagnostics,
      3,
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_INVALID_FIELD_MASK', line: 1 }),
        expect.objectContaining({ code: 'FDQL_INVALID_FIELD_PATH', line: 2 }),
        expect.objectContaining({ code: 'FDQL_INVALID_FIELD_MASK', line: 3 }),
      ]),
    );
  });
});
