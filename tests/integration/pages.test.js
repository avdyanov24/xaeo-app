import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

describe('page routes', () => {
  it('redirects / to /login, or to /app when signed in, without caching', async (t) => {
    const { request, signIn } = await startTestServer(t);
    const anonymous = await request('GET', '/');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.location, '/login');
    assert.equal(anonymous.headers['cache-control'], 'no-store');
    const cookie = await signIn();
    assert.equal((await request('GET', '/', { headers: { cookie } })).headers.location, '/app');
  });

  it('sends /app to /login without a session and returns after sign-in', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('GET', '/app');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login?next=%2Fapp');
  });

  it('serves the login and signup pages, and skips them when signed in', async (t) => {
    const { request, signIn } = await startTestServer(t);
    for (const path of ['/login', '/signup']) {
      const res = await request('GET', path);
      assert.equal(res.status, 200);
      assert.match(res.body, /<script src="\/portal\.js" defer><\/script>/);
    }
    const cookie = await signIn();
    for (const path of ['/login', '/signup']) {
      const res = await request('GET', path, { headers: { cookie } });
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/app');
    }
  });

  it('serves the app shell at /app as html that revalidates', async (t) => {
    const { request, signIn } = await startTestServer(t);
    const cookie = await signIn();
    const res = await request('GET', '/app', { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(res.body, /<script type="module" src="\/ui\/js\/main\.js">/);
  });

  it('answers HEAD /app with headers and no body', async (t) => {
    const { request, signIn } = await startTestServer(t);
    const cookie = await signIn();
    const res = await request('HEAD', '/app', { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
    assert.ok(Number(res.headers['content-length']) > 0);
  });

  it('keeps the security headers on static responses', async (t) => {
    const { request, signIn } = await startTestServer(t);
    const cookie = await signIn();
    const res = await request('GET', '/app', { headers: { cookie } });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  });

  it('does not accept writes on a page route', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('POST', '/app', { json: {} });
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET');
  });
});
