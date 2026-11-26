import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

describe('GET /api/app/engines', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/engines')).status, 401);
  });

  it('lists ChatGPT and Claude as sample engines and nothing else', async (t) => {
    const server = await startTestServer(t);
    const cookie = await server.signIn();
    const { status, json } = await server.request('GET', '/api/app/engines', {
      headers: { cookie },
    });
    assert.equal(status, 200);
    assert.equal(json.mode, 'sample');
    assert.deepEqual(json.engines, [
      { id: 'chatgpt', name: 'ChatGPT', provider: 'OpenAI', state: 'sample' },
      { id: 'claude', name: 'Claude', provider: 'Anthropic', state: 'sample' },
    ]);
  });
});
