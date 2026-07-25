import { describe, expect, it } from 'vitest';
import { analyzeFirestoreSql } from './analyzer.ts';
import { parseFirestoreSql } from './parser.ts';

const context = {
  defaultProjectId: 'local',
  projectAliases: {
    prod: 'prod-project',
    source: 'prod-project',
    staging: 'staging-project',
    target: 'staging-project',
  },
};

describe('Firestore SQL analyzer', () => {
  it.each([
    [
      'select with project aliases and join',
      `select id(src) as orderId, src.status, dst.status as targetStatus
from project($source).orders src
left join project($target).orders dst on id(dst) = id(src)`,
    ],
    [
      'dynamic subcollection delete',
      `delete o
from customers c
cross join subcollection(c, "orders") o
where c.disabled = true
  and o.status = "test"`,
    ],
    [
      'entry driven update',
      `update g
from games g
cross join entries(g.rounds) r
set
  field_path("rounds", key(r), "description") = "changed"
where id(g) = "game_1"
  and key(r) in ("id-1", "id-2")`,
    ],
    [
      'insert values with write helper',
      `insert into audit(createdAt, message)
values (server_timestamp(), "created")`,
    ],
  ])('accepts valid fixture: %s', (_name, sql) => {
    expect(analyze(sql)).toMatchObject({ ok: true, diagnostics: [] });
  });

  it('rejects duplicate aliases in one statement scope', () => {
    expect(analyze('select id(o) from orders o left join users o on id(o) = o.userId'))
      .toMatchObject({
        diagnostics: [{ code: 'DUPLICATE_ALIAS' }],
        ok: false,
      });
  });

  it('rejects unknown aliases in expressions', () => {
    expect(analyze('select missing.status from orders o')).toMatchObject({
      diagnostics: [{ code: 'UNKNOWN_ALIAS' }],
      ok: false,
    });
  });

  it('rejects missing project context aliases', () => {
    expect(analyze('select * from project($missing).orders o')).toMatchObject({
      diagnostics: [{ code: 'MISSING_PROJECT_ALIAS' }],
      ok: false,
    });
  });

  it('rejects collection group paths', () => {
    expect(analyze('select * from collection_group("customers/orders") o')).toMatchObject({
      diagnostics: [{ code: 'INVALID_COLLECTION_GROUP_ID' }],
      ok: false,
    });
  });

  it('rejects invalid explicit collection paths', () => {
    expect(analyze('select * from collection("customers/cus_123") o')).toMatchObject({
      diagnostics: [{ code: 'INVALID_COLLECTION_PATH' }],
      ok: false,
    });
  });

  it('rejects write helpers in select expressions', () => {
    expect(analyze('select server_timestamp() as now from orders o')).toMatchObject({
      diagnostics: [{ code: 'WRITE_HELPER_OUTSIDE_WRITE_VALUE' }],
      ok: false,
    });
  });

  it('rejects unknown delete target aliases', () => {
    expect(analyze('delete missing from orders o where o.status = "test"')).toMatchObject({
      diagnostics: [{ code: 'UNKNOWN_TARGET_ALIAS' }],
      ok: false,
    });
  });

  it('rejects unknown update target aliases', () => {
    expect(
      analyze(`update missing
from orders o
set archived = true`),
    ).toMatchObject({
      diagnostics: [{ code: 'UNKNOWN_TARGET_ALIAS' }],
      ok: false,
    });
  });

  it('allows cross-project writes with one resolved target project', () => {
    expect(
      analyze(`update project("staging").orders stage
from project("prod").orders prod
set copiedStatus = prod.status
where id(stage) = id(prod)`),
    ).toMatchObject({ ok: true, diagnostics: [] });
  });
});

function analyze(sql: string) {
  const parsed = parseFirestoreSql(sql);
  expect(parsed, sql).toMatchObject({ ok: true, diagnostics: [] });
  if (!parsed.ok) throw new Error('Expected SQL to parse.');
  return analyzeFirestoreSql(parsed.ast, context);
}
