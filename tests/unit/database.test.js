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
  it('applies the identity, client, Xo and fix migrations on open', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(tableNames(db), [
      'answers',
      'clients',
      'fix_evidence',
      'fix_handoffs',
      'fixes',
      'memberships',
      'questions',
      'scans',
      'schema_migrations',
      'sessions',
      'users',
      'workspaces',
      'xo_approvals',
      'xo_artifact_events',
      'xo_artifact_versions',
      'xo_artifacts',
      'xo_cards',
      'xo_conversations',
      'xo_messages',
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

  it('deletes a client with its fixes, their evidence and their handoffs', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      INSERT INTO workspaces (id, name) VALUES (1, 'A');
      INSERT INTO clients (id, workspace_id, name, domain) VALUES (1, 1, 'One', 'one.test');
      INSERT INTO questions (id, workspace_id, client_id, text) VALUES (1, 1, 1, 'Q one?');
      INSERT INTO scans (id, workspace_id, client_id, number, state, total) VALUES (1, 1, 1, 1, 'done', 1);
      INSERT INTO answers (id, workspace_id, scan_id, question_id, question_text, engine, status)
        VALUES (1, 1, 1, 1, 'Q one?', 'chatgpt', 'ok');
      INSERT INTO fixes (id, workspace_id, client_id, position, title, type, impact, evidence, url, why, code, lang, verify)
        VALUES (1, 1, 1, 1, 'Fix', 'page', 'High', 'Strong', 'https://one.test/', 'Why', 'Code', 'text', 'Verify');
      INSERT INTO fix_evidence (workspace_id, fix_id, answer_id) VALUES (1, 1, 1);
      INSERT INTO fix_handoffs (workspace_id, fix_id, channel, content_hash) VALUES (1, 1, 'csv', 'h');
    `);
    db.prepare('DELETE FROM clients WHERE id = 1').run();
    for (const table of ['fixes', 'fix_evidence', 'fix_handoffs'])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
  });

  it('gives a new workspace the default brand colour and time zone, and no logo', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO workspaces (id, name) VALUES (1, 'A')");
    assert.deepEqual(
      { ...db.prepare('SELECT * FROM workspaces').get(), created_at: 'x' },
      {
        id: 1,
        name: 'A',
        created_at: 'x',
        color: '#1F3BFF',
        website: '',
        contact: '',
        logo: null,
        logo_type: null,
        logo_updated_at: null,
        timezone: 'Europe/London',
      },
    );
  });

  it('deletes a client with the Xo drafts, approvals and cards made for it', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      INSERT INTO workspaces (id, name) VALUES (1, 'A');
      INSERT INTO users (id, email, name, password_hash) VALUES (1, 'a@one.test', 'A', 'x');
      INSERT INTO clients (id, workspace_id, name, domain) VALUES (1, 1, 'One', 'one.test');
      INSERT INTO xo_conversations (id, workspace_id, user_id) VALUES (1, 1, 1);
      INSERT INTO xo_artifacts (id, workspace_id, client_id, kind, title, code)
        VALUES (1, 1, 1, 'llms_txt', 'llms.txt', '# One');
      INSERT INTO xo_artifact_versions (artifact_id, version, code, content_hash) VALUES (1, 1, '# One', 'h');
      INSERT INTO xo_approvals (workspace_id, artifact_id, version, content_hash) VALUES (1, 1, 1, 'h');
      INSERT INTO xo_artifact_events (workspace_id, artifact_id, action, actor_type) VALUES (1, 1, 'artifact_created', 'xo');
      INSERT INTO xo_cards (workspace_id, conversation_id, client_id, kind, artifact_id) VALUES (1, 1, 1, 'artifact', 1);
    `);
    db.prepare('DELETE FROM clients WHERE id = 1').run();
    for (const table of [
      'xo_artifacts',
      'xo_artifact_versions',
      'xo_approvals',
      'xo_artifact_events',
      'xo_cards',
    ])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
    assert.equal(db.prepare('SELECT count(*) AS n FROM xo_conversations').get().n, 1);
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
