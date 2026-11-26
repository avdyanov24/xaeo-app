import { request as httpRequest, createServer } from 'node:http';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { openDatabase } from '../../src/server/db/database.js';
import { createLogger } from '../../src/server/lib/logger.js';

/**
 * Starts the app on a random port with a fresh in-memory database,
 * and stops both when the test ends.
 * @param {import('node:test').TestContext} t
 */
export async function startTestServer(t, env = {}) {
  const config = loadConfig({ NODE_ENV: 'test', PORT: '0', ...env });
  const db = openDatabase(config.databasePath);
  const logger = createLogger({ level: 'silent' });
  const server = createServer(createApp({ config, logger, db }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)).then(() => db.close()));
  const { port } = server.address();
  const request = (method, path, options) => send(port, method, path, options);
  return { db, request, signIn: () => signIn(request) };
}

/** Signs up a new account and resolves with its `cookie` header value (`name=value`). */
async function signIn(request) {
  const res = await request('POST', '/api/signup', {
    json: {
      name: 'Test User',
      email: `user-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'a long test password',
      workspaceName: 'Test Agency',
    },
  });
  if (res.status !== 201) throw new Error(`signup failed with ${res.status}`);
  return res.headers['set-cookie'][0].split(';')[0];
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
