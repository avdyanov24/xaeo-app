import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate.js';

/**
 * Opens the SQLite database and brings its schema up to date.
 * `:memory:` gives a private, throwaway database, which is what the tests use.
 * @param {string} path file path or `:memory:`
 */
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Foreign keys are off by default in SQLite and must be enabled per connection.
  db.exec('PRAGMA foreign_keys = ON');
  // WAL lets readers continue while a write is in progress; it has no effect in memory.
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  runMigrations(db);
  return db;
}

/**
 * Runs `work` inside a transaction: commits when it returns, rolls back when it throws.
 * `work` must be synchronous, which `node:sqlite` already is.
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} work
 * @returns {T}
 */
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
