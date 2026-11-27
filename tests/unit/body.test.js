import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { readBuffer, readJson } from '../../src/server/http/body.js';
import { HttpError } from '../../src/server/lib/errors.js';

function fakeRequest(text, headers = { 'content-type': 'application/json' }) {
  const req = Readable.from(text ? [Buffer.from(text)] : []);
  req.headers = headers;
  return req;
}

describe('readJson', () => {
  it('parses a JSON body', async () => {
    assert.deepEqual(await readJson(fakeRequest('{"name":"Northside Plumbing"}')), {
      name: 'Northside Plumbing',
    });
  });

  it('reads an empty body as an empty object', async () => {
    assert.deepEqual(await readJson(fakeRequest('', {})), {});
  });

  it('rejects malformed JSON with 400', async () => {
    await assert.rejects(
      readJson(fakeRequest('{nope')),
      (e) => e instanceof HttpError && e.status === 400,
    );
  });

  it('rejects a non-JSON content type with 415', async () => {
    await assert.rejects(
      readJson(fakeRequest('a=1', { 'content-type': 'application/x-www-form-urlencoded' })),
      (e) => e.status === 415,
    );
  });

  it('rejects bodies over the limit with 413, by header or by streamed size', async () => {
    await assert.rejects(
      readJson(fakeRequest('{}', { 'content-type': 'application/json', 'content-length': '999' }), {
        limit: 10,
      }),
      (e) => e.status === 413,
    );
    await assert.rejects(
      readJson(fakeRequest(`"${'x'.repeat(50)}"`), { limit: 10 }),
      (e) => e.status === 413,
    );
  });
});

describe('readBuffer', () => {
  it('returns the raw bytes of the body', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const req = Readable.from([bytes]);
    req.headers = {};
    assert.deepEqual([...(await readBuffer(req, { limit: 10 }))], [...bytes]);
  });

  it('returns an empty Buffer for an empty body', async () => {
    assert.equal((await readBuffer(fakeRequest('', {}))).length, 0);
  });

  it('stops with 413 over the limit, by the declared length or by the streamed size', async () => {
    await assert.rejects(
      readBuffer(fakeRequest('x', { 'content-length': '11' }), { limit: 10 }),
      (e) => e.status === 413,
    );
    await assert.rejects(
      readBuffer(fakeRequest('0123456789ab', {}), { limit: 10 }),
      (e) => e.status === 413,
    );
  });
});
