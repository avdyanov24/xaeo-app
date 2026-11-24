import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRouter } from './http/router.js';
import { sendError, sendJson, setSecurityHeaders } from './http/respond.js';
import { HttpError } from './lib/errors.js';
import { registerRoutes } from './routes/index.js';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

/**
 * Builds the request handler. Route handlers receive a context object and either
 * return a value (sent as 200 JSON), return `{ status, body }`, or write to `ctx.res` themselves.
 * @param {{ config: ReturnType<import('./config.js').loadConfig>, logger: ReturnType<import('./lib/logger.js').createLogger> }} deps
 */
export function createApp({ config, logger }) {
  const router = createRouter();
  registerRoutes(router, { config, logger, version, startedAt: Date.now() });

  return async function handle(req, res) {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    setSecurityHeaders(res);

    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const found = router.match(req.method ?? 'GET', url.pathname);
      if (!found) throw new HttpError(404, 'not_found', 'Not found.');

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
