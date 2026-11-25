import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { before, after, describe, it } from 'node:test';
import { createStaticFiles } from '../../src/server/http/static.js';

/** A writable stream that also records the status and headers passed to writeHead. */
function fakeResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  res.chunks = chunks;
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
    return res;
  };
  return res;
}

describe('static files', () => {
  let dir;
  let files;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xaeo-static-'));
    await mkdir(join(dir, 'web', 'ui'), { recursive: true });
    await writeFile(join(dir, 'web', 'app.html'), '<!doctype html><p>hi</p>');
    await writeFile(join(dir, 'web', 'ui', 'main.js'), 'export const x = 1;\n');
    await writeFile(join(dir, 'web', '.env'), 'SECRET=1');
    await writeFile(join(dir, 'secret.txt'), 'outside');
    await symlink(join(dir, 'secret.txt'), join(dir, 'web', 'link.txt'));
    files = createStaticFiles({ root: join(dir, 'web') });
  });
  after(() => rm(dir, { recursive: true, force: true }));

  const serve = async (pathname, { method = 'GET', headers = {} } = {}) => {
    const res = fakeResponse();
    await files.serve({ method, headers }, res, pathname);
    return res;
  };

  it('sends html with no-cache and a content type', async () => {
    const res = await serve('/app.html');
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['Cache-Control'], 'no-cache');
    assert.equal(Buffer.concat(res.chunks).toString(), '<!doctype html><p>hi</p>');
  });

  it('gives other files a short max-age and the right type', async () => {
    const res = await serve('/ui/main.js');
    assert.equal(res.headers['Content-Type'], 'text/javascript; charset=utf-8');
    assert.equal(res.headers['Cache-Control'], 'public, max-age=300');
  });

  it('answers 304 when the ETag matches', async () => {
    const first = await serve('/ui/main.js');
    const res = await serve('/ui/main.js', { headers: { 'if-none-match': first.headers.ETag } });
    assert.equal(res.status, 304);
    assert.equal(res.chunks.length, 0);
  });

  it('sends headers but no body for HEAD', async () => {
    const res = await serve('/app.html', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Length'], 24);
    assert.equal(res.chunks.length, 0);
  });

  it('rejects methods other than GET and HEAD with 405', async () => {
    await assert.rejects(serve('/app.html', { method: 'POST' }), { status: 405 });
  });

  for (const pathname of [
    '/missing.html',
    '/ui',
    '/',
    '/.env',
    '/ui/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/ui/..%2f..%2fsecret.txt',
    '/ui/%5c..%5csecret.txt',
    '/app.html%00.png',
    '/%E0%A4%A',
    '/link.txt',
  ]) {
    it(`returns 404 for ${pathname}`, async () => {
      await assert.rejects(serve(pathname), { status: 404, code: 'not_found' });
    });
  }
});
