import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRouter } from './http/router.js';
import { createSessionHttp } from './http/session.js';
import { createStaticFiles } from './http/static.js';
import { sendError, sendJson, setSecurityHeaders } from './http/respond.js';
import { HttpError, notFound } from './lib/errors.js';
import { createFailureLimiter } from './lib/rate-limit.js';
import { registerRoutes } from './routes/index.js';
import { createAuthService } from './services/auth-service.js';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../web', import.meta.url));

/**
 * Builds the request handler. Route handlers receive a context object and either
 * return a value (sent as 200 JSON), return `{ status, body }`, or write to `ctx.res` themselves.
 * Requests that match no route and are not under `/api` fall through to the static files in `webRoot`.
 * @param {{ config: ReturnType<import('./config.js').loadConfig>, logger: ReturnType<import('./lib/logger.js').createLogger>, db: import('node:sqlite').DatabaseSync, webRoot?: string }} deps
 */
export function createApp({ config, logger, db, webRoot = DEFAULT_WEB_ROOT }) {
  const auth = createAuthService({ db, sessionTtlMs: config.sessionTtlMs });
  const sessionHttp = createSessionHttp({ auth, config });
  // Five wrong passwords per address and email, then a 15-minute wait.
  const loginLimiter = createFailureLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });
  const router = createRouter();
  const staticFiles = createStaticFiles({ root: webRoot });
  registerRoutes(router, {
    config,
    logger,
    version,
    startedAt: Date.now(),
    auth,
    sessionHttp,
    loginLimiter,
    staticFiles,
  });

  return async function handle(req, res) {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    setSecurityHeaders(res);

    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const found = router.match(req.method ?? 'GET', url.pathname);
      if (!found) {
        const isFileRequest = req.method === 'GET' || req.method === 'HEAD';
        if (!isFileRequest || url.pathname.startsWith('/api/')) throw notFound();
        await staticFiles.serve(req, res, url.pathname);
        return;
      }

      const result = await found.handler({ req, res, url, params: found.params, requestId });
      if (!res.headersSent) {
        if (result && typeof result === 'object' && 'status' in result && 'body' in result)
          sendJson(res, result.status, result.body);
        else if (result === undefined) res.writeHead(204).end();
        else sendJson(res, 200, result);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(res, error.status, error.code, error.message, error.details);
      } else {
        logger.error('unhandled_error', { requestId, error: error?.stack ?? String(error) });
        if (!res.headersSent) sendError(res, 500, 'internal_error', 'Something went wrong.');
        else res.destroy();
      }
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', {
        requestId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
      });
    }
  };
}
