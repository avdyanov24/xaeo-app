import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

const WEB_ROOT = new URL('../../src/web/', import.meta.url);

// Stylesheets that belong to a page milestone that has not landed yet. A reference to one of these
// is only skipped while the file is missing from src/web, so the check starts covering it the
// moment the file is added.
const NOT_YET_ADDED = new Set(['/ui/app.css']);

/** Local URLs a page references through src and href attributes, without anchors and query strings. */
function pageReferences(html) {
  const urls = [...html.matchAll(/\b(?:src|href)="(\/[^"#?]*)/g)].map((m) => m[1]);
  return urls.filter((url) => /\.[a-z0-9]+$/i.test(url));
}

/** Relative `from './x.js'` imports in a module, resolved against the module's own URL path. */
function moduleImports(source, modulePath) {
  const specifiers = [...source.matchAll(/\bfrom\s+'(\.[^']+)'/g)].map((m) => m[1]);
  return specifiers.map((spec) => posix.join(dirname(modulePath), spec));
}

/** Every file app.html loads, plus every module reachable from main.js. */
async function collectAssets() {
  const html = await readFile(new URL('app.html', WEB_ROOT), 'utf8');
  const found = new Set(pageReferences(html));
  const queue = ['/ui/js/main.js'];
  while (queue.length) {
    const path = queue.pop();
    if (found.has(`import:${path}`)) continue;
    found.add(`import:${path}`);
    found.add(path);
    const source = await readFile(new URL(path.slice(1), WEB_ROOT), 'utf8');
    queue.push(...moduleImports(source, path));
  }
  return [...found].filter((p) => !p.startsWith('import:')).sort();
}

describe('web assets', () => {
  it('serves every file the app shell and its modules reference', async (t) => {
    const { request } = await startTestServer(t);
    const assets = (await collectAssets()).filter(
      (url) => !(NOT_YET_ADDED.has(url) && !existsSync(new URL(url.slice(1), WEB_ROOT))),
    );
    // Guards the walk itself: an empty or shallow list would make this test pass for nothing.
    for (const expected of [
      '/ui/js/main.js',
      '/ui/js/views/overview.js',
      '/ds/tokens/colors.css',
      '/assets/wordmark-163.webp',
    ])
      assert.ok(assets.includes(expected), `the walk did not reach ${expected}`);
    for (const url of assets) {
      const res = await request('GET', url);
      assert.equal(res.status, 200, `${url} returned ${res.status}`);
    }
  });

  it('sets content types for scripts, styles, fonts and images', async (t) => {
    const { request } = await startTestServer(t);
    const types = {
      '/ui/js/main.js': 'text/javascript; charset=utf-8',
      '/ds/tokens/colors.css': 'text/css; charset=utf-8',
      '/ds/fonts/Inter-normal.woff2': 'font/woff2',
      '/assets/favicon/favicon.svg': 'image/svg+xml',
      '/assets/wordmark-48.webp': 'image/webp',
      '/assets/favicon/apple-touch-icon.png': 'image/png',
    };
    for (const [url, type] of Object.entries(types)) {
      const res = await request('GET', url);
      assert.equal(res.headers['content-type'], type, url);
      assert.equal(res.headers['cache-control'], 'public, max-age=300', url);
    }
  });

  it('answers 304 when the browser already has the current file', async (t) => {
    const { request } = await startTestServer(t);
    const first = await request('GET', '/ui/js/lib.js');
    const again = await request('GET', '/ui/js/lib.js', {
      headers: { 'if-none-match': first.headers.etag },
    });
    assert.equal(again.status, 304);
    assert.equal(again.body, '');
  });

  for (const path of [
    '/ui/../../package.json',
    '/ui/%2e%2e/%2e%2e/package.json',
    '/ui/..%2f..%2fpackage.json',
    '/%2e%2e/server/index.js',
    '/.env',
    '/ui/.hidden',
    '/ui/js',
    '/ui/js/',
    '/package.json',
    '/src/server/index.js',
  ]) {
    it(`does not serve ${path}`, async (t) => {
      const { request } = await startTestServer(t);
      const res = await request('GET', path);
      assert.equal(res.status, 404);
      assert.equal(res.json?.error.code, 'not_found');
    });
  }
});
