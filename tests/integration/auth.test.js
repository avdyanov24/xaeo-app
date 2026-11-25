import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

const SIGNUP = {
  name: 'Alex Morgan',
  email: 'alex@brightline.example',
  password: 'a long sample password',
  workspaceName: 'Brightline Digital',
};

/** The `name=value` part of the session cookie a response set. */
const sessionCookie = (res) => res.headers['set-cookie']?.[0]?.split(';')[0];

async function signUp(request, body = SIGNUP) {
  const res = await request('POST', '/api/auth/signup', { json: body });
  return { res, cookie: sessionCookie(res) };
}

describe('auth API', () => {
  it('signup returns 201 with the user and workspace and sets an HttpOnly cookie', async (t) => {
    const { request } = await startTestServer(t);
    const { res } = await signUp(request);
    assert.equal(res.status, 201);
    assert.deepEqual(res.json, {
      user: { id: 1, email: SIGNUP.email, name: SIGNUP.name, role: 'user' },
      workspace: { id: 1, name: SIGNUP.workspaceName, role: 'owner' },
    });
    const header = res.headers['set-cookie'][0];
    assert.match(header, /^xaeo_session=[\w-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/);
    assert.ok(!res.body.includes('password'));
  });

  it('marks the cookie Secure in production', async (t) => {
    const { request } = await startTestServer(t, {
      NODE_ENV: 'production',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    });
    const { res } = await signUp(request);
    assert.match(res.headers['set-cookie'][0], /; Secure;/);
  });

  it('signup validates every field and enforces the password length', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('POST', '/api/auth/signup', { json: { email: 'not-an-email' } });
    assert.equal(res.status, 422);
    assert.deepEqual(res.json.error.issues.map((issue) => issue.field).sort(), [
      'email',
      'name',
      'password',
      'workspaceName',
    ]);
    const short = await request('POST', '/api/auth/signup', {
      json: { ...SIGNUP, password: 'short' },
    });
    assert.equal(short.status, 422);
    assert.deepEqual(short.json.error.issues, [
      { field: 'password', message: 'must be at least 10 characters' },
    ]);
  });

  it('signup with a taken email returns 409', async (t) => {
    const { request } = await startTestServer(t);
    await signUp(request);
    const { res } = await signUp(request, { ...SIGNUP, email: 'Alex@Brightline.example' });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'conflict');
  });

  it('GET /api/auth/session returns the session for the cookie and 401 without it', async (t) => {
    const { request } = await startTestServer(t);
    const { cookie } = await signUp(request);
    const signedIn = await request('GET', '/api/auth/session', { headers: { cookie } });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.json.user.email, SIGNUP.email);
    const anonymous = await request('GET', '/api/auth/session');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, 'unauthorized');
  });

  it('login sets a new session and replaces the old one', async (t) => {
    const { request } = await startTestServer(t);
    const { cookie: first } = await signUp(request);
    const res = await request('POST', '/api/auth/login', {
      json: { email: SIGNUP.email, password: SIGNUP.password },
      headers: { cookie: first },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.workspace.name, SIGNUP.workspaceName);
    const second = sessionCookie(res);
    assert.notEqual(second, first);
    assert.equal(
      (await request('GET', '/api/auth/session', { headers: { cookie: first } })).status,
      401,
    );
    assert.equal(
      (await request('GET', '/api/auth/session', { headers: { cookie: second } })).status,
      200,
    );
  });

  it('login with wrong credentials returns 401 and no cookie', async (t) => {
    const { request } = await startTestServer(t);
    await signUp(request);
    for (const json of [
      { email: SIGNUP.email, password: 'not the password' },
      { email: 'nobody@example.com', password: 'whatever it is' },
      { email: SIGNUP.email, password: 12345 },
    ]) {
      const res = await request('POST', '/api/auth/login', { json });
      assert.equal(res.status, 401);
      assert.equal(res.json.error.message, 'Email or password is incorrect.');
      assert.equal(res.headers['set-cookie'], undefined);
    }
  });

  it('logout ends the session and clears the cookie', async (t) => {
    const { request } = await startTestServer(t);
    const { cookie } = await signUp(request);
    const res = await request('POST', '/api/auth/logout', { headers: { cookie } });
    assert.equal(res.status, 204);
    assert.match(res.headers['set-cookie'][0], /^xaeo_session=; Path=\/; Max-Age=0;/);
    assert.equal((await request('GET', '/api/auth/session', { headers: { cookie } })).status, 401);
  });

  it('logout without a session still succeeds', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('POST', '/api/auth/logout')).status, 204);
  });

  it('stores no raw session tokens or plain passwords', async (t) => {
    const { request, db } = await startTestServer(t);
    const { cookie } = await signUp(request);
    const token = cookie.split('=')[1];
    const dump = JSON.stringify([
      db.prepare('SELECT * FROM sessions').all(),
      db.prepare('SELECT * FROM users').all(),
    ]);
    assert.ok(!dump.includes(token));
    assert.ok(!dump.includes(SIGNUP.password));
  });
});
