import { readdirSync, readFileSync } from 'node:fs';
import { transaction } from './database.js';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
const FILE_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** Lists migration files in order as `{ version, name, sql }`. */
export function loadMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = FILE_NAME.exec(name);
      if (!match) throw new Error(`Migration file name must look like 001_name.sql: ${name}`);
      return { version: Number(match[1]), name, sql: readFileSync(new URL(name, dir), 'utf8') };
    })
    .sort((a, b) => a.version - b.version);
}

/**
 * Applies every migration that has not run yet, each in its own transaction,
 * and records it in `schema_migrations`. Safe to call on every start.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string[]} names of the migrations applied by this call
 */
export function runMigrations(db, migrations = loadMigrations()) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT`);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  );
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');

  const ran = [];
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name);
    });
    ran.push(migration.name);
  }
  return ran;
}
