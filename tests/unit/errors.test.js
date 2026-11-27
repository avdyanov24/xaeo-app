import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  methodNotAllowed,
  notFound,
  payloadTooLarge,
  tooManyRequests,
  unauthorized,
  unsupportedMediaType,
  validationFailed,
} from '../../src/server/lib/errors.js';

describe('errors', () => {
  it('carries a status, a code and a message', () => {
    const error = new HttpError(418, 'teapot', 'Short and stout.');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'HttpError');
    assert.equal(error.status, 418);
    assert.equal(error.code, 'teapot');
    assert.equal(error.message, 'Short and stout.');
  });

  it('only has a details field when details were given', () => {
    assert.equal('details' in new HttpError(400, 'bad_request', 'x'), false);
    assert.deepEqual(new HttpError(400, 'bad_request', 'x', { a: 1 }).details, { a: 1 });
  });

  it('maps each helper to its status and code', () => {
    const cases = [
      [badRequest(), 400, 'bad_request'],
      [unauthorized(), 401, 'unauthorized'],
      [forbidden(), 403, 'forbidden'],
      [notFound(), 404, 'not_found'],
      [methodNotAllowed(['GET']), 405, 'method_not_allowed'],
      [conflict(), 409, 'conflict'],
      [payloadTooLarge(10), 413, 'payload_too_large'],
      [unsupportedMediaType('application/json'), 415, 'unsupported_media_type'],
      [validationFailed([]), 422, 'validation_failed'],
      [tooManyRequests(30), 429, 'too_many_requests'],
    ];
    for (const [error, status, code] of cases) {
      assert.equal(error.status, status, code);
      assert.equal(error.code, code);
    }
  });

  it('lets a caller replace the default message', () => {
    assert.equal(notFound('No such client.').message, 'No such client.');
    assert.equal(unauthorized().message, 'Sign in to continue.');
  });

  it('puts the extra fields the envelope needs into details', () => {
    assert.deepEqual(methodNotAllowed(['GET', 'HEAD']).details, { allowed: ['GET', 'HEAD'] });
    assert.deepEqual(tooManyRequests(30).details, { retryAfterSeconds: 30 });
    assert.deepEqual(validationFailed([{ field: 'email' }]).details, {
      issues: [{ field: 'email' }],
    });
    assert.equal(payloadTooLarge(1024).message, 'Request body is larger than 1024 bytes.');
    assert.equal(unsupportedMediaType('application/json').message, 'Expected application/json.');
  });
});
