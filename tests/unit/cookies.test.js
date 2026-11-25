import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCookies, serializeCookie } from '../../src/server/http/cookies.js';

describe('cookies', () => {
  it('parses a Cookie header', () => {
    assert.deepEqual(parseCookies('a=1; b="two"; c=x%20y'), { a: '1', b: 'two', c: 'x y' });
  });

  it('skips malformed pairs and keeps the first of repeated names', () => {
    assert.deepEqual(parseCookies('junk; =v; a=1; a=2; bad=%E0%A4%A'), { a: '1' });
    assert.deepEqual(parseCookies(undefined), {});
  });

  it('serialises with safe defaults', () => {
    assert.equal(serializeCookie('s', 'a b'), 's=a%20b; Path=/; HttpOnly; SameSite=Lax');
  });

  it('adds Max-Age and Secure when asked', () => {
    assert.equal(
      serializeCookie('s', '', { maxAgeSeconds: -5, secure: true, sameSite: 'Strict' }),
      's=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    );
  });
});
