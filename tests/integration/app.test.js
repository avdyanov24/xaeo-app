import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

describe('HTTP app', () => {
  it('GET /api/health reports status and version', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
    assert.match(res.json.version, /^\d+\.\d+\.\d+/);
    assert.equal(typeof res.json.uptimeSeconds, 'number');
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('sets a request id and security headers on every response', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('GET', '/api/health');
    assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });

  it('HEAD /api/health returns headers without a body', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('HEAD', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
  });

  it('unknown routes return the JSON error envelope with 404', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('GET', '/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: { code: 'not_found', message: 'Not found.' } });
  });

  it('a wrong method returns 405 with an Allow header', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('POST', '/api/health');
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET');
    assert.equal(res.json.error.code, 'method_not_allowed');
  });
});
