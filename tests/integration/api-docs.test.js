import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadConfig } from '../../src/server/config.js';
import { openDatabase } from '../../src/server/db/database.js';
import { createRouter } from '../../src/server/http/router.js';
import { createSessionHttp } from '../../src/server/http/session.js';
import { createStaticFiles } from '../../src/server/http/static.js';
import { createFailureLimiter } from '../../src/server/lib/rate-limit.js';
import { registerRoutes } from '../../src/server/routes/index.js';
import { createAuthService } from '../../src/server/services/auth-service.js';

const API_DOCS = readFileSync(new URL('../../docs/api.md', import.meta.url), 'utf8');
const HEADINGS = API_DOCS.split('\n').filter((line) => line.startsWith('### '));

/** Registers the real route modules on a router so their method and path can be listed. */
function registeredRoutes() {
  const config = loadConfig({ NODE_ENV: 'test' });
  const auth = createAuthService({ db: openDatabase(':memory:') });
  const router = createRouter();
  registerRoutes(router, {
    config,
    version: '0.0.0',
    startedAt: Date.now(),
    auth,
    sessionHttp: createSessionHttp({ auth, config }),
    loginLimiter: createFailureLimiter({ limit: 1, windowMs: 1 }),
    staticFiles: createStaticFiles({ root: new URL('../../src/web', import.meta.url).pathname }),
  });
  return router.routes();
}

describe('docs/api.md', () => {
  it('has a heading for every registered route', () => {
    const missing = registeredRoutes()
      .map(({ method, pattern }) => `\`${method} ${pattern}\``)
      .filter((route) => !HEADINGS.some((heading) => heading.includes(route)));
    assert.deepEqual(missing, [], `Add a "### " heading to docs/api.md for: ${missing.join(', ')}`);
  });
});
