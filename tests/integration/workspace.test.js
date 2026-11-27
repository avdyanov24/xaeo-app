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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not a real picture, only the signature matters'),
]);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const upload = (call, body, type) =>
  call('POST', '/api/app/brand/logo', { body, headers: { 'content-type': type } });

describe('the agency logo', () => {
  it('uploads a PNG, serves it back and puts its URL in /me', async (t) => {
    const { call } = await setup(t);
    const res = await upload(call, PNG, 'image/png');
    assert.equal(res.status, 200);
    assert.match(res.json.workspace.logo, /^\/api\/app\/brand\/logo\?v=\d+$/);
    assert.equal(res.json.onboarding.brand, true);

    const file = await call('GET', res.json.workspace.logo);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.equal(file.body, PNG.toString('utf8'));
    assert.match(file.headers['content-security-policy'], /sandbox/);
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
    assert.equal((await call('GET', '/api/app/me')).json.workspace.logo, res.json.workspace.logo);
  });

  it('accepts an SVG, ignoring a charset on the type', async (t) => {
    const { call } = await setup(t);
    const res = await upload(call, SVG, 'image/svg+xml; charset=utf-8');
    assert.equal(res.status, 200);
    assert.equal(
      (await call('GET', '/api/app/brand/logo')).headers['content-type'],
      'image/svg+xml',
    );
  });

  it('removes the logo, and removing it again is harmless', async (t) => {
    const { call } = await setup(t);
    await upload(call, PNG, 'image/png');
    const gone = await call('POST', '/api/app/brand/logo/delete');
    assert.equal(gone.status, 200);
    assert.equal(gone.json.workspace.logo, null);
    assert.equal((await call('GET', '/api/app/brand/logo')).status, 404);
    assert.equal((await call('POST', '/api/app/brand/logo/delete')).status, 200);
  });

  it('refuses a file over 300 KB with 413', async (t) => {
    const { call } = await setup(t);
    const big = Buffer.concat([PNG, Buffer.alloc(300 * 1024)]);
    assert.equal((await upload(call, big, 'image/png')).status, 413);
    assert.equal((await call('GET', '/api/app/brand/logo')).status, 404);
  });

  it('refuses another type with 415, and bytes that are not the declared image with 422', async (t) => {
    const { call } = await setup(t);
    assert.equal((await upload(call, PNG, 'image/gif')).status, 415);
    assert.equal((await upload(call, PNG, 'text/html')).status, 415);
    assert.equal((await upload(call, 'GIF89a', 'image/png')).status, 422);
    assert.equal((await upload(call, '', 'image/png')).status, 422);
    assert.equal(
      (await upload(call, '<svg><script>alert(1)</script></svg>', 'image/svg+xml')).status,
      422,
    );
    assert.equal((await call('GET', '/api/app/brand/logo')).status, 404);
  });

  it('keeps the old logo when a new upload is refused', async (t) => {
    const { call } = await setup(t);
    await upload(call, PNG, 'image/png');
    await upload(call, 'GIF89a', 'image/png');
    assert.equal((await call('GET', '/api/app/brand/logo')).status, 200);
  });

  it('is changed by owners only, and read by any member', async (t) => {
    const { call, demote } = await setup(t);
    await upload(call, PNG, 'image/png');
    demote();
    assert.equal((await upload(call, PNG, 'image/png')).status, 403);
    assert.equal((await call('POST', '/api/app/brand/logo/delete')).status, 403);
    assert.equal((await call('GET', '/api/app/brand/logo')).status, 200);
  });

  it('shows one workspace only its own logo', async (t) => {
    const { call, request, signIn } = await setup(t);
    const outsider = await signIn();
    await upload(call, PNG, 'image/png');
    const theirs = await request('GET', '/api/app/brand/logo', { headers: { cookie: outsider } });
    assert.equal(theirs.status, 404);
    assert.equal((await request('GET', '/api/app/brand/logo')).status, 401);
  });
});

describe('POST /api/app/workspace/timezone', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    const res = await request('POST', '/api/app/workspace/timezone', {
      json: { timezone: 'UTC' },
    });
    assert.equal(res.status, 401);
  });

  it('saves a zone and shows it in /me after a reload', async (t) => {
    const { call } = await setup(t);
    const res = await call('POST', '/api/app/workspace/timezone', {
      json: { timezone: 'Europe/Sofia' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { timezone: 'Europe/Sofia' });
    assert.equal((await call('GET', '/api/app/me')).json.workspace.timezone, 'Europe/Sofia');
    const utc = await call('POST', '/api/app/workspace/timezone', { json: { timezone: 'UTC' } });
    assert.equal(utc.json.timezone, 'UTC');
  });

  it('answers 400 for a zone it does not know and keeps the old one', async (t) => {
    const { call } = await setup(t);
    for (const timezone of ['Mars/Olympus', '+02:00', 'Europe/London; DROP TABLE workspaces'])
      assert.equal(
        (await call('POST', '/api/app/workspace/timezone', { json: { timezone } })).status,
        400,
        timezone,
      );
    assert.equal((await call('GET', '/api/app/me')).json.workspace.timezone, 'Europe/London');
  });

  it('answers 422 when the zone is missing', async (t) => {
    const { call } = await setup(t);
    assert.equal((await call('POST', '/api/app/workspace/timezone', { json: {} })).status, 422);
  });

  it('is for the workspace owner only and never changes another workspace', async (t) => {
    const { call, request, signIn, demote } = await setup(t);
    const outsider = await signIn();
    await call('POST', '/api/app/workspace/timezone', { json: { timezone: 'Asia/Tokyo' } });
    const theirs = await request('GET', '/api/app/me', { headers: { cookie: outsider } });
    assert.equal(theirs.json.workspace.timezone, 'Europe/London');

    demote();
    const res = await call('POST', '/api/app/workspace/timezone', { json: { timezone: 'UTC' } });
    assert.equal(res.status, 403);
    assert.equal((await call('GET', '/api/app/me')).json.workspace.timezone, 'Asia/Tokyo');
  });
});

describe('GET /api/app/export', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/export')).status, 401);
  });

  it('downloads the workspace with its clients, answers and fixes', async (t) => {
    const { call } = await setup(t);
    await call('POST', '/api/app/brand', { json: BRAND });
    await upload(call, PNG, 'image/png');
    const sample = (await call('POST', '/api/app/sample')).json.id;
    await call('POST', '/api/app/fixes/2/status', { json: { status: 'done' } });
    await call('POST', `/api/app/clients/${sample}/handoffs`, {
      json: { fixIds: ['1'], channel: 'csv' },
    });

    const res = await call('GET', '/api/app/export');
    assert.equal(res.status, 200);
    assert.equal(
      res.headers['content-disposition'],
      'attachment; filename="xaeo-workspace-export.json"',
    );
    assert.equal(res.headers['cache-control'], 'no-store');

    const doc = res.json;
    assert.ok(Date.parse(doc.exportedAt) > 0);
    assert.deepEqual(doc.workspace, {
      name: 'Brightline Digital',
      color: '#0F766E',
      website: 'brightline.example',
      contact: 'hello@brightline.example',
      timezone: 'Europe/London',
      hasLogo: true,
    });
    assert.deepEqual(
      doc.members.map((m) => [m.name, m.role]),
      [['Test User', 'owner']],
    );
    const [client] = doc.clients;
    assert.equal(client.name, 'Northside Plumbing');
    assert.equal(client.questions.length, 5);
    assert.equal(client.scans.length, 1);
    assert.equal(client.scans[0].answers.length, 10);
    assert.equal(client.fixes.length, 4);
    assert.equal(client.fixes[1].status, 'done');
    assert.equal(client.fixes[0].handoffs.length, 1);
    assert.ok(
      client.fixes[0].answerIds.every((id) => client.scans[0].answers.some((a) => a.id === id)),
    );
  });

  it('leaves out passwords, session tokens and the logo file', async (t) => {
    const { call } = await setup(t);
    await upload(call, PNG, 'image/png');
    await call('POST', '/api/app/sample');
    const text = (await call('GET', '/api/app/export')).body;
    for (const secret of ['password', 'token', 'scrypt', 'hash', 'logo_type'])
      assert.equal(text.toLowerCase().includes(secret), false, secret);
    assert.equal(text.includes('iVBOR'), false, 'no base64 of the logo');
  });

  it("holds only this workspace's clients and members", async (t) => {
    const { call, request, signIn } = await setup(t);
    const outsider = await signIn();
    await call('POST', '/api/app/sample');
    const theirs = await request('GET', '/api/app/export', { headers: { cookie: outsider } });
    assert.deepEqual(theirs.json.clients, []);
    assert.equal(theirs.json.members.length, 1);
  });

  it('is for the workspace owner only', async (t) => {
    const { call, demote } = await setup(t);
    demote();
    assert.equal((await call('GET', '/api/app/export')).status, 403);
  });
});
