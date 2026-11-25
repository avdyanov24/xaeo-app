import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionHttp, SESSION_COOKIE } from '../../src/server/http/session.js';

const SESSIONS = {
  member: { user: { id: 1, role: 'user' }, workspace: { id: 1, role: 'owner' } },
  admin: { user: { id: 2, role: 'admin' }, workspace: { id: 1, role: 'member' } },
};
const auth = { getSession: (token) => SESSIONS[token] ?? null };
const guards = createSessionHttp({ auth, config: { secureCookies: false } });
const ctxFor = (token) => ({
  req: { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} },
});

describe('route guards', () => {
  it('authenticated passes the session to the handler', () => {
    const handler = guards.authenticated((ctx) => ctx.session.user.id);
    assert.equal(handler(ctxFor('member')), 1);
  });

  it('authenticated rejects a missing or unknown session with 401', () => {
    const handler = guards.authenticated(() => 'reached');
    assert.throws(() => handler(ctxFor(undefined)), { status: 401 });
    assert.throws(() => handler(ctxFor('stale')), { status: 401 });
  });

  it('adminOnly rejects signed-in non-admins with 403', () => {
    const handler = guards.adminOnly(() => 'reached');
    assert.throws(() => handler(ctxFor('member')), { status: 403 });
    assert.equal(handler(ctxFor('admin')), 'reached');
    assert.throws(() => handler(ctxFor(undefined)), { status: 401 });
  });
});
