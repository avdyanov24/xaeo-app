import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

describe('page routes', () => {
  it('redirects / to /app without caching the redirect', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('GET', '/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/app');
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('serves the app shell at /app as html that revalidates', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('GET', '/app');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(res.body, /<script type="module" src="\/ui\/js\/main\.js">/);
  });

  it('answers HEAD /app with headers and no body', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('HEAD', '/app');
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
    assert.ok(Number(res.headers['content-length']) > 0);
  });

  it('keeps the security headers on static responses', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('GET', '/app');
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
