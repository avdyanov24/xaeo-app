import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase, transaction } from '../../src/server/db/database.js';
import { runMigrations } from '../../src/server/db/migrate.js';

const tableNames = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

describe('database', () => {
  it('applies the identity migration on open', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(tableNames(db), [
      'memberships',
      'schema_migrations',
      'sessions',
      'users',
      'workspaces',
    ]);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  });

  it('does not re-run migrations that are already recorded', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(runMigrations(db), []);
  });

  it('applies new migrations in version order', () => {
    const db = openDatabase(':memory:');
    const ran = runMigrations(db, [
      { version: 901, name: '901_b.sql', sql: 'ALTER TABLE t ADD COLUMN b TEXT;' },
      { version: 900, name: '900_a.sql', sql: 'CREATE TABLE t (a TEXT) STRICT;' },
    ]);
    assert.deepEqual(ran, ['900_a.sql', '901_b.sql']);
  });

  it('rolls back a migration that fails part-way', () => {
    const db = openDatabase(':memory:');
    assert.throws(() =>
      runMigrations(db, [
        {
          version: 902,
          name: '902_bad.sql',
          sql: 'CREATE TABLE half (a TEXT); SELECT nope FROM missing;',
        },
      ]),
    );
    assert.ok(!tableNames(db).includes('half'));
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version = 902').get().n,
      0,
    );
  });

  it('transaction commits on success and rolls back on error', () => {
    const db = openDatabase(':memory:');
    transaction(db, () => db.prepare('INSERT INTO workspaces (name) VALUES (?)').run('Kept'));
    assert.throws(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO workspaces (name) VALUES (?)').run('Dropped');
        throw new Error('stop');
      }),
    );
    const names = db
      .prepare('SELECT name FROM workspaces')
      .all()
      .map((row) => row.name);
    assert.deepEqual(names, ['Kept']);
  });
});
