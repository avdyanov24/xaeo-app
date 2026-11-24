import { request as httpRequest, createServer } from 'node:http';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { createLogger } from '../../src/server/lib/logger.js';

/**
 * Starts the app on a random port and stops it when the test ends.
 * @param {import('node:test').TestContext} t
 */
export async function startTestServer(t, env = {}) {
  const config = loadConfig({ NODE_ENV: 'test', PORT: '0', ...env });
  const server = createServer(createApp({ config, logger: createLogger({ level: 'silent' }) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return { request: (method, path, options) => send(port, method, path, options) };
}

/**
 * Sends one request without keep-alive and resolves with `{ status, headers, body, json }`.
 * `options.json` is serialised as the body; `options.body` is sent as-is.
 */
function send(port, method, path, { json, body, headers = {} } = {}) {
  const payload = json !== undefined ? JSON.stringify(json) : body;
  const allHeaders = { ...headers };
  if (json !== undefined) allHeaders['content-type'] ??= 'application/json';
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers: allHeaders, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : undefined;
          } catch {
            parsed = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: text, json: parsed });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}
