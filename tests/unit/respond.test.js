import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sendError,
  sendJson,
  sendRedirect,
  setSecurityHeaders,
} from '../../src/server/http/respond.js';

/** A minimal response that records what the helpers write to it. */
function fakeResponse(method = 'GET') {
  const res = {
    req: { method },
    headers: {},
    status: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

describe('respond', () => {
  it('sets the security headers', () => {
    const res = fakeResponse();
    setSecurityHeaders(res);
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(res.headers['X-Frame-Options'], 'DENY');
    assert.equal(res.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(res.headers['Cross-Origin-Opener-Policy'], 'same-origin');
  });

  it('sends JSON that is never cached, with the right length', () => {
    const res = fakeResponse();
    sendJson(res, 201, { name: 'Zoë' });
    assert.equal(res.status, 201);
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Content-Length'], Buffer.byteLength(res.body));
    assert.deepEqual(JSON.parse(res.body), { name: 'Zoë' });
  });

  it('sends the headers but no body for HEAD', () => {
    const res = fakeResponse('HEAD');
    sendJson(res, 200, { ok: true });
    assert.equal(res.body, undefined);
    assert.equal(res.headers['Content-Length'], Buffer.byteLength('{"ok":true}'));
  });

  it('wraps an error in the standard envelope', () => {
    const res = fakeResponse();
    sendError(res, 422, 'validation_failed', 'Some fields are invalid.', { issues: [] });
    assert.equal(res.status, 422);
    assert.deepEqual(JSON.parse(res.body), {
      error: { code: 'validation_failed', message: 'Some fields are invalid.', issues: [] },
    });
  });

  it('adds Allow to a 405 and Retry-After to a 429', () => {
    const notAllowed = fakeResponse();
    sendError(notAllowed, 405, 'method_not_allowed', 'Method not allowed.', {
      allowed: ['GET', 'HEAD'],
    });
    assert.equal(notAllowed.headers.Allow, 'GET, HEAD');

    const limited = fakeResponse();
    sendError(limited, 429, 'too_many_requests', 'Too many attempts.', { retryAfterSeconds: 30 });
    assert.equal(limited.headers['Retry-After'], '30');
  });

  it('leaves the extra headers off other errors', () => {
    const res = fakeResponse();
    sendError(res, 404, 'not_found', 'Not found.');
    assert.equal(res.headers.Allow, undefined);
    assert.equal(res.headers['Retry-After'], undefined);
  });

  it('redirects with a 302 that is not cached', () => {
    const res = fakeResponse();
    sendRedirect(res, '/login');
    assert.equal(res.status, 302);
    assert.equal(res.headers.Location, '/login');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });
});
