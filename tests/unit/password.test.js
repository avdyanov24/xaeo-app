import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, needsRehash, verifyPassword } from '../../src/server/lib/password.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
    assert.equal(await verifyPassword('correct horse battery stapler', hash), false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    assert.notEqual(a, b);
  });

  it('treats Unicode forms of the same password as equal', async () => {
    const hash = await hashPassword('café-pass');
    assert.equal(await verifyPassword('café-pass', hash), true);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    for (const stored of ['', 'plain', 'scrypt$x$8$1$aa$bb', 'bcrypt$1$2$3$4$5', null]) {
      assert.equal(await verifyPassword('anything', stored), false);
    }
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    const weak = await hashPassword('pw', { N: 1024, r: 8, p: 1 });
    assert.equal(await verifyPassword('pw', weak), true);
    assert.equal(needsRehash(weak), true);
    assert.equal(needsRehash(await hashPassword('pw')), false);
  });
});
