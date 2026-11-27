import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, options = {}) =>
    server.request(method, path, { ...options, headers: { cookie, ...options.headers } });
  /** Turns the signed-in user into a plain member of their workspace. */
  const demote = () => server.db.prepare("UPDATE memberships SET role = 'member'").run();
  return { ...server, call, demote };
}

const BRAND = {
  name: 'Brightline Digital',
  color: '#0f766e',
  website: 'brightline.example',
  contact: 'hello@brightline.example',
};

describe('POST /api/app/brand', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('POST', '/api/app/brand', { json: BRAND })).status, 401);
  });

  it('saves the brand, answers with the app context and keeps it across a reload', async (t) => {
    const { call } = await setup(t);
    const res = await call('POST', '/api/app/brand', { json: BRAND });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.workspace, {
      id: 1,
      name: 'Brightline Digital',
      color: '#0F766E',
      website: 'brightline.example',
      contact: 'hello@brightline.example',
      timezone: 'Europe/London',
      logo: null,
    });
    const me = (await call('GET', '/api/app/me')).json;
    assert.deepEqual(me.workspace, res.json.workspace);
    assert.equal(me.onboarding.brand, true);
  });

  it('falls back to the default colour and empty contact details when they are left out', async (t) => {
    const { call } = await setup(t);
    const { json } = await call('POST', '/api/app/brand', { json: { name: 'Plain Agency' } });
    assert.equal(json.workspace.color, '#1F3BFF');
    assert.equal(json.workspace.website, '');
    assert.equal(json.onboarding.brand, false);
  });

  it('rejects a bad name or colour and changes nothing', async (t) => {
    const { call } = await setup(t);
    for (const body of [
      { ...BRAND, name: '' },
      { ...BRAND, name: 'x'.repeat(101) },
      { ...BRAND, color: 'teal' },
      { ...BRAND, color: '#12345' },
      { ...BRAND, website: 'x'.repeat(201) },
    ]) {
      const res = await call('POST', '/api/app/brand', { json: body });
      assert.equal(res.status, 422, JSON.stringify(body).slice(0, 50));
      assert.equal(res.json.error.code, 'validation_failed');
    }
    assert.equal((await call('GET', '/api/app/me')).json.workspace.name, 'Test Agency');
  });

  it('is for the workspace owner only', async (t) => {
    const { call, demote } = await setup(t);
    demote();
    const res = await call('POST', '/api/app/brand', { json: BRAND });
    assert.equal(res.status, 403);
    assert.equal((await call('GET', '/api/app/me')).json.workspace.name, 'Test Agency');
  });

  it('never changes another workspace', async (t) => {
    const { call, request, signIn } = await setup(t);
    const outsider = await signIn();
    await call('POST', '/api/app/brand', { json: BRAND });
    const theirs = await request('GET', '/api/app/me', { headers: { cookie: outsider } });
    assert.equal(theirs.json.workspace.name, 'Test Agency');
    assert.equal(theirs.json.workspace.website, '');
  });
});
