import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as sessions from '../../src/server/repositories/session-repository.js';
import * as users from '../../src/server/repositories/user-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';

let db;
let workspaceId;
let userId;

beforeEach(() => {
  db = openDatabase(':memory:');
  workspaceId = workspaces.insertWorkspace(db, 'Brightline Digital');
  userId = users.insertUser(db, {
    email: 'Owner@Brightline.test',
    name: 'Owner',
    passwordHash: 'hash',
  });
  workspaces.insertMembership(db, { workspaceId, userId, role: 'owner' });
});

const open = (tokenHash, expiresAt = '2099-01-01T00:00:00.000Z') =>
  sessions.insertSession(db, { tokenHash, userId, workspaceId, expiresAt });

describe('user repository', () => {
  it('finds a user by email without regard to case', () => {
    assert.equal(users.findUserByEmail(db, 'owner@brightline.test').id, userId);
    assert.equal(users.findUserByEmail(db, 'nobody@brightline.test'), undefined);
  });

  it('gives a new user the user role unless told otherwise', () => {
    assert.equal(users.findUserById(db, userId).role, 'user');
    const admin = users.insertUser(db, {
      email: 'admin@brightline.test',
      name: 'Admin',
      passwordHash: 'hash',
      role: 'admin',
    });
    assert.equal(users.findUserById(db, admin).role, 'admin');
  });

  it('refuses a second account with the same email in another case', () => {
    assert.throws(() =>
      users.insertUser(db, { email: 'OWNER@brightline.test', name: 'Copy', passwordHash: 'x' }),
    );
  });

  it('replaces the stored password hash', () => {
    users.updatePasswordHash(db, userId, 'new-hash');
    assert.equal(users.findUserById(db, userId).passwordHash, 'new-hash');
  });
});

describe('session repository', () => {
  it('loads a session with its user and workspace', () => {
    open('abc');
    assert.deepEqual(sessions.findSession(db, 'abc'), {
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: { id: userId, email: 'Owner@Brightline.test', name: 'Owner', role: 'user' },
      workspace: { id: workspaceId, name: 'Brightline Digital', role: 'owner' },
    });
  });

  it('finds nothing for an unknown token hash', () => {
    assert.equal(sessions.findSession(db, 'missing'), undefined);
  });

  it('deletes one session and ignores an unknown hash', () => {
    open('abc');
    open('def');
    sessions.deleteSession(db, 'abc');
    sessions.deleteSession(db, 'never-existed');
    assert.equal(sessions.findSession(db, 'abc'), undefined);
    assert.ok(sessions.findSession(db, 'def'));
  });

  it('removes only the sessions that have expired', () => {
    open('old', '2026-11-26T10:00:00.000Z');
    open('edge', '2026-11-27T10:00:00.000Z');
    open('live', '2026-11-28T10:00:00.000Z');
    assert.equal(sessions.deleteExpiredSessions(db, '2026-11-27T10:00:00.000Z'), 2);
    assert.equal(sessions.findSession(db, 'old'), undefined);
    assert.equal(sessions.findSession(db, 'edge'), undefined);
    assert.ok(sessions.findSession(db, 'live'));
  });

  it('stops working when the user leaves the workspace', () => {
    open('abc');
    db.prepare('DELETE FROM memberships WHERE user_id = ?').run(userId);
    assert.equal(sessions.findSession(db, 'abc'), undefined);
  });
});
