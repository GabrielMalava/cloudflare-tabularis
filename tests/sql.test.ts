import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  columnDefinitionSql,
  defaultLiteral,
  isReadQuery,
  isWrappable,
  normalizeParam,
  quoteIdent,
  quoteLiteral,
  stripTrailingSemicolon,
} from '../src/sql.ts';

test('quoteIdent escapes embedded double quotes', () => {
  assert.equal(quoteIdent('users'), '"users"');
  assert.equal(quoteIdent('we"ird'), '"we""ird"');
});

test('quoteLiteral escapes single quotes', () => {
  assert.equal(quoteLiteral("a'b"), "'a''b'");
});

test('isReadQuery / isWrappable classify statements', () => {
  assert.ok(isReadQuery('  SELECT 1'));
  assert.ok(isReadQuery('PRAGMA table_info(x)'));
  assert.ok(isWrappable('WITH t AS (SELECT 1) SELECT * FROM t'));
  assert.ok(!isWrappable('PRAGMA table_info(x)'));
  assert.ok(!isReadQuery('UPDATE t SET a = 1'));
});

test('stripTrailingSemicolon trims one trailing semicolon', () => {
  assert.equal(stripTrailingSemicolon('SELECT 1;  '), 'SELECT 1');
  assert.equal(stripTrailingSemicolon('SELECT 1'), 'SELECT 1');
});

test('normalizeParam coerces booleans and JSON', () => {
  assert.equal(normalizeParam(true), 1);
  assert.equal(normalizeParam(false), 0);
  assert.equal(normalizeParam(undefined), null);
  assert.equal(normalizeParam(null), null);
  assert.equal(normalizeParam(42), 42);
  assert.equal(normalizeParam({ a: 1 }), '{"a":1}');
});

test('defaultLiteral keeps raw keywords/numbers, quotes text', () => {
  assert.equal(defaultLiteral('0'), '0');
  assert.equal(defaultLiteral('CURRENT_TIMESTAMP'), 'CURRENT_TIMESTAMP');
  assert.equal(defaultLiteral('hello'), "'hello'");
});

test('columnDefinitionSql builds an inline primary key', () => {
  const sql = columnDefinitionSql(
    { name: 'id', data_type: 'INTEGER', is_nullable: false, is_pk: true, is_auto_increment: true },
    true,
  );
  assert.equal(sql, '"id" INTEGER PRIMARY KEY AUTOINCREMENT');
});

test('columnDefinitionSql builds a not-null column with default', () => {
  const sql = columnDefinitionSql(
    { name: 'status', data_type: 'TEXT', is_nullable: false, is_pk: false, is_auto_increment: false, default_value: 'active' },
    false,
  );
  assert.equal(sql, `"status" TEXT NOT NULL DEFAULT 'active'`);
});
