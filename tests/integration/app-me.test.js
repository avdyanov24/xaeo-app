import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

const SIGNUP = {
  name: 'Alex Morgan',
  email: 'alex@brightline.example',
  password: 'a long sample password',
  workspaceName: 'Brightline Digital',
};

describe('GET /api/app/me', () => {
  it('returns the user, workspace and sample engines for the session', async (t) => {
    const { request } = await startTestServer(t);
    const signup = await request('POST', '/api/signup', { json: SIGNUP });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const res = await request('GET', '/api/app/me', { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.user, {
      id: 1,
      email: SIGNUP.email,
      name: SIGNUP.name,
      role: 'user',
      workspaceRole: 'owner',
    });
    assert.deepEqual(res.json.workspace, {
      id: 1,
      name: 'Brightline Digital',
      timezone: 'Europe/London',
    });
    assert.deepEqual(
      res.json.engines.map((engine) => engine.name),
      ['ChatGPT', 'Claude'],
    );
    assert.equal(res.json.engineStatus.mode, 'sample');
    assert.ok(res.json.engineStatus.engines.every((engine) => engine.state === 'sample'));
  });

  it('returns 401 without a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/me')).status, 401);
  });
});
