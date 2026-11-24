import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRouter } from '../../src/server/http/router.js';
import { HttpError } from '../../src/server/lib/errors.js';

describe('createRouter', () => {
  const router = createRouter();
  const list = () => 'list';
  const show = () => 'show';
  const update = () => 'update';
  router.get('/api/clients', list);
  router.get('/api/clients/:id', show);
  router.patch('/api/clients/:id', update);

  it('matches static and parameterised paths', () => {
    assert.equal(router.match('GET', '/api/clients').handler, list);
    const found = router.match('GET', '/api/clients/abc-123');
    assert.equal(found.handler, show);
    assert.deepEqual(found.params, { id: 'abc-123' });
  });

  it('accepts a trailing slash and decodes parameters', () => {
    assert.deepEqual(router.match('GET', '/api/clients/a%20b/').params, { id: 'a b' });
  });

  it('serves HEAD with the GET handler', () => {
    assert.equal(router.match('HEAD', '/api/clients').handler, list);
  });

  it('returns null for unknown paths', () => {
    assert.equal(router.match('GET', '/api/unknown'), null);
    assert.equal(router.match('GET', '/api/clients/1/extra'), null);
  });

  it('throws 405 with the allowed methods when only the method is wrong', () => {
    assert.throws(
      () => router.match('DELETE', '/api/clients/1'),
      (error) =>
        error instanceof HttpError &&
        error.status === 405 &&
        error.details.allowed.join() === 'GET,PATCH',
    );
  });

  it('treats regex characters in patterns literally', () => {
    const r = createRouter();
    r.get('/api/fixes.csv', list);
    assert.equal(r.match('GET', '/api/fixesXcsv'), null);
    assert.equal(r.match('GET', '/api/fixes.csv').handler, list);
  });
});
