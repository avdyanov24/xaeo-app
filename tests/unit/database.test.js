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
  it('applies the identity and client migrations on open', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(tableNames(db), [
      'answers',
      'clients',
      'memberships',
      'questions',
      'scans',
      'schema_migrations',
      'sessions',
      'users',
      'workspaces',
    ]);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  });

  it('deletes a client with its questions, scans and answers, and nothing else', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      INSERT INTO workspaces (id, name) VALUES (1, 'A'), (2, 'B');
      INSERT INTO clients (id, workspace_id, name, domain) VALUES (1, 1, 'One', 'one.test'), (2, 2, 'Two', 'two.test');
      INSERT INTO questions (id, workspace_id, client_id, text) VALUES (1, 1, 1, 'Q one?'), (2, 2, 2, 'Q two?');
      INSERT INTO scans (id, workspace_id, client_id, number, state, total) VALUES (1, 1, 1, 1, 'done', 1), (2, 2, 2, 1, 'done', 1);
      INSERT INTO answers (workspace_id, scan_id, question_id, question_text, engine, status)
        VALUES (1, 1, 1, 'Q one?', 'chatgpt', 'ok'), (2, 2, 2, 'Q two?', 'chatgpt', 'ok');
    `);
    db.prepare('DELETE FROM clients WHERE id = 1').run();
    for (const table of ['questions', 'scans', 'answers'])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 1, table);
  });

  it('rejects an unknown engine, scan state or question intent', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      INSERT INTO workspaces (id, name) VALUES (1, 'A');
      INSERT INTO clients (id, workspace_id, name, domain) VALUES (1, 1, 'One', 'one.test');
      INSERT INTO questions (id, workspace_id, client_id, text) VALUES (1, 1, 1, 'Q?');
      INSERT INTO scans (id, workspace_id, client_id, number, state, total) VALUES (1, 1, 1, 1, 'queued', 1);
    `);
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO answers (workspace_id, scan_id, question_id, question_text, engine, status) VALUES (1, 1, 1, 'Q?', 'other-engine', 'ok')",
        )
        .run(),
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO scans (workspace_id, client_id, number, state, total) VALUES (1, 1, 2, 'paused', 1)",
        )
        .run(),
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO questions (workspace_id, client_id, text, intent) VALUES (1, 1, 'Q?', 'x')",
        )
        .run(),
    );
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
