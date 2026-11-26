import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/server/db/database.js';
import { SEED_ACCOUNTS, SEED_WORKSPACE } from '../../src/server/db/seed/accounts.js';
import { runSeeds } from '../../src/server/db/seed/index.js';
import { createAuthService } from '../../src/server/services/auth-service.js';

const SEED_SCRIPT = fileURLToPath(new URL('../../scripts/db-seed.js', import.meta.url));
const RESET_SCRIPT = fileURLToPath(new URL('../../scripts/db-reset.js', import.meta.url));

describe('seed data', () => {
  it('creates Brightline Digital with a user and an admin who can log in', async () => {
    const db = openDatabase(':memory:');
    const created = await runSeeds(db);
    assert.deepEqual(created.accounts, ['user@brightline.test', 'admin@brightline.test']);

    const auth = createAuthService({ db });
    const [user, admin] = SEED_ACCOUNTS;
    const asUser = await auth.login({ email: user.email, password: user.password });
    assert.equal(asUser.session.user.role, 'user');
    assert.deepEqual(asUser.session.workspace, { id: 1, name: SEED_WORKSPACE, role: 'owner' });
    const asAdmin = await auth.login({ email: admin.email, password: admin.password });
    assert.equal(asAdmin.session.user.role, 'admin');
    assert.equal(asAdmin.session.workspace.id, asUser.session.workspace.id);
  });

  it('changes nothing when run again', async () => {
    const db = openDatabase(':memory:');
    await runSeeds(db);
    assert.deepEqual(await runSeeds(db), { accounts: [], northside: [] });
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM workspaces').get().n, 1);
  });

  it('uses .test addresses and passwords long enough for signup rules', () => {
    for (const account of SEED_ACCOUNTS) {
      assert.match(account.email, /@[a-z]+\.test$/);
      assert.ok(account.password.length >= 10);
    }
  });
});

const runScript = (script, env) =>
  spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH, LOG_LEVEL: 'silent', ...env },
    encoding: 'utf8',
  });

describe('npm run db:seed', () => {
  const run = (env) => runScript(SEED_SCRIPT, env);

  it('seeds the database file it is pointed at', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xaeo-seed-'));
    try {
      const result = run({ NODE_ENV: 'development', DATABASE_PATH: join(dir, 'seed.db') });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /accounts: user@brightline\.test, admin@brightline\.test/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to run in production', () => {
    const result = run({ NODE_ENV: 'production', DATABASE_PATH: ':memory:' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refuses to run with NODE_ENV=production/);
  });
});

describe('npm run db:reset', () => {
  it('wipes the database and seeds it again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xaeo-reset-'));
    const path = join(dir, 'reset.db');
    try {
      const db = openDatabase(path);
      await runSeeds(db);
      db.prepare('INSERT INTO workspaces (name) VALUES (?)').run('Left over');
      db.close();

      const result = runScript(RESET_SCRIPT, { NODE_ENV: 'development', DATABASE_PATH: path });
      assert.equal(result.status, 0, result.stderr);
      const fresh = openDatabase(path);
      const names = fresh
        .prepare('SELECT name FROM workspaces')
        .all()
        .map((row) => row.name);
      fresh.close();
      assert.deepEqual(names, [SEED_WORKSPACE]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to run in production or without a database file', () => {
    const production = runScript(RESET_SCRIPT, { NODE_ENV: 'production', DATABASE_PATH: 'x.db' });
    assert.equal(production.status, 1);
    const memory = runScript(RESET_SCRIPT, { NODE_ENV: 'development', DATABASE_PATH: ':memory:' });
    assert.equal(memory.status, 1);
    assert.match(memory.stderr, /needs a database file/);
  });
});
