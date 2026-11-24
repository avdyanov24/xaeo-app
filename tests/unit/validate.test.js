import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../../src/server/lib/errors.js';
import { validate } from '../../src/server/lib/validate.js';

const schema = {
  name: { type: 'string', required: true, min: 2, max: 20 },
  email: { type: 'email' },
  limit: { type: 'integer', min: 1, max: 100, default: 20 },
  status: { type: 'enum', values: ['open', 'done'] },
  archived: { type: 'boolean' },
};

describe('validate', () => {
  it('trims strings, coerces integer strings, applies defaults and drops unknown fields', () => {
    const result = validate(schema, { name: '  Northside  ', extra: 'x', archived: false });
    assert.deepEqual(result, { name: 'Northside', limit: 20, archived: false });
    assert.equal(validate(schema, { name: 'ab', limit: '50' }).limit, 50);
  });

  it('lists every issue in a 422 error', () => {
    try {
      validate(schema, { email: 'nope', limit: 0, status: 'later', archived: 'yes' });
      assert.fail('expected validate to throw');
    } catch (error) {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'validation_failed');
      assert.deepEqual(
        error.details.issues.map((i) => i.field),
        ['name', 'email', 'limit', 'status', 'archived'],
      );
    }
  });

  it('enforces string length bounds', () => {
    assert.throws(() => validate(schema, { name: 'a' }), HttpError);
    assert.throws(() => validate(schema, { name: 'a'.repeat(21) }), HttpError);
  });

  it('treats a non-object body as empty input', () => {
    assert.throws(() => validate(schema, ['Northside']), HttpError);
    assert.throws(() => validate(schema, null), HttpError);
  });
});
