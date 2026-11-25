import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import { hashPassword } from '../../src/server/lib/password.js';
import { createAuthService, hashToken } from '../../src/server/services/auth-service.js';
import {
  updatePasswordHash,
  findUserByEmail,
} from '../../src/server/repositories/user-repository.js';

const ALEX = {
  name: 'Alex Morgan',
  email: 'alex@brightline.example',
  password: 'a long sample password',
  workspaceName: 'Brightline Digital',
};

describe('auth service', () => {
  let db, clock, auth;
  beforeEach(() => {
    db = openDatabase(':memory:');
    clock = { now: Date.parse('2026-11-25T12:00:00Z') };
    auth = createAuthService({ db, sessionTtlMs: 60_000, now: () => clock.now });
  });

  it('signup creates the user, an owned workspace and a session', async () => {
    const { token, expiresAt, session } = await auth.signup(ALEX);
    assert.equal(typeof token, 'string');
    assert.equal(expiresAt, '2026-11-25T12:01:00.000Z');
    assert.equal(session.user.email, ALEX.email);
    assert.equal(session.user.role, 'user');
    assert.deepEqual(session.workspace, { id: 1, name: 'Brightline Digital', role: 'owner' });
  });

  it('stores only the hash of the session token', async () => {
    const { token } = await auth.signup(ALEX);
    const stored = db.prepare('SELECT token_hash FROM sessions').all();
    assert.deepEqual(
      stored.map((row) => row.token_hash),
      [hashToken(token)],
    );
  });

  it('rejects a second signup with the same email in any letter case', async () => {
    await auth.signup(ALEX);
    await assert.rejects(auth.signup({ ...ALEX, email: 'ALEX@Brightline.example' }), {
      status: 409,
      code: 'conflict',
    });
  });

  it('settles a race between two signups with the same email', async () => {
    const results = await Promise.allSettled([auth.signup(ALEX), auth.signup(ALEX)]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
    assert.equal(db.prepare('SELECT count(*) AS n FROM workspaces').get().n, 1);
  });

  it('login with the right password starts a new session', async () => {
    await auth.signup(ALEX);
    const { token, session } = await auth.login({ email: ALEX.email, password: ALEX.password });
    assert.equal(auth.getSession(token).user.id, session.user.id);
  });

  it('login gives the same error for a wrong password and an unknown email', async () => {
    await auth.signup(ALEX);
    const expected = { status: 401, message: 'Email or password is incorrect.' };
    await assert.rejects(auth.login({ email: ALEX.email, password: 'wrong password!' }), expected);
    await assert.rejects(auth.login({ email: 'nobody@example.com', password: 'x' }), expected);
  });

  it('upgrades a weak password hash on login', async () => {
    await auth.signup(ALEX);
    const user = findUserByEmail(db, ALEX.email);
    updatePasswordHash(db, user.id, await hashPassword(ALEX.password, { N: 1024, r: 8, p: 1 }));
    await auth.login({ email: ALEX.email, password: ALEX.password });
    assert.match(findUserByEmail(db, ALEX.email).passwordHash, /^scrypt\$32768\$/);
  });

  it('logout ends the session and ignores unknown tokens', async () => {
    const { token } = await auth.signup(ALEX);
    auth.logout(token);
    assert.equal(auth.getSession(token), null);
    assert.doesNotThrow(() => auth.logout('unknown'));
    assert.doesNotThrow(() => auth.logout(undefined));
  });

  it('expired sessions are rejected and removed', async () => {
    const { token } = await auth.signup(ALEX);
    clock.now += 60_000;
    assert.equal(auth.getSession(token), null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  });

  it('a session stops working when the membership is removed', async () => {
    const { token, session } = await auth.signup(ALEX);
    db.prepare('DELETE FROM memberships WHERE user_id = ?').run(session.user.id);
    assert.equal(auth.getSession(token), null);
  });
});
