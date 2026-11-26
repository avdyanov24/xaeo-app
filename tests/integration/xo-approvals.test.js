import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

/** Signs in, adds the example client and asks Xo for an llms.txt; resolves with the draft's card. */
async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  await call('POST', '/api/app/sample');
  const stream = (await call('POST', '/api/app/xo/turn', { text: 'Draft an llms.txt' })).body;
  const card = JSON.parse(
    stream
      .split('\n\n')
      .find((c) => c.startsWith('event: card'))
      .split('\n')[1]
      .slice(6),
  ).card;
  const fill = (
    version,
    values = { FILL_IN_ONE_LINE_SUMMARY: 'Boiler repairs', FILL_IN_CONTACT_PATH: 'contact' },
  ) =>
    call('POST', `/api/app/xo/artifacts/${card.artifact.artifactId}/edit`, {
      version,
      fill: values,
    });
  return { ...server, call, cookie, card, fill };
}

describe('xo approvals routes', () => {
  it('require a session', async (t) => {
    const { request, card } = await setup(t);
    const id = card.artifact.artifactId;
    assert.equal((await request('GET', '/api/app/xo/approvals')).status, 401);
    assert.equal(
      (await request('POST', '/api/app/xo/approvals/1/decide', { json: {} })).status,
      401,
    );
    assert.equal((await request('GET', `/api/app/xo/artifacts/${id}`)).status, 401);
    assert.equal(
      (await request('POST', `/api/app/xo/artifacts/${id}/edit`, { json: {} })).status,
      401,
    );
    assert.equal(
      (await request('POST', `/api/app/xo/artifacts/${id}/apply`, { json: {} })).status,
      401,
    );
    assert.equal((await request('GET', `/api/app/xo/artifacts/${id}/download`)).status, 401);
  });

  it('queues the draft Xo made and counts it as pending', async (t) => {
    const { call, card } = await setup(t);
    const { json } = await call('GET', '/api/app/xo/approvals');
    assert.equal(json.pendingCount, 1);
    assert.equal(json.approvals[0].artifactId, card.artifact.artifactId);
    assert.equal(json.approvals[0].clientName, 'Northside Plumbing');
    assert.equal(
      (await call('GET', '/api/app/xo/approvals?status=approved')).json.approvals.length,
      0,
    );
    assert.equal((await call('GET', '/api/app/xo/approvals?status=maybe')).status, 422);
  });

  it('takes a draft from pending to approved to exported and downloads the file', async (t) => {
    const { call, card, fill } = await setup(t);
    const id = card.artifact.artifactId;
    const blocked = await call('POST', `/api/app/xo/approvals/${card.artifact.approvalId}/decide`, {
      decision: 'approve',
      contentHash: card.artifact.contentHash,
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error.code, 'approve_blocked');

    const edited = await fill(1);
    assert.equal(edited.status, 200);
    assert.equal(edited.json.artifact.version, 2);
    assert.equal(edited.json.staleApprovalIds.length, 1);
    const next = edited.json.card.artifact;
    assert.deepEqual(next.placeholders, []);

    const decided = await call('POST', `/api/app/xo/approvals/${next.approvalId}/decide`, {
      decision: 'approve',
      contentHash: next.contentHash,
    });
    assert.equal(decided.json.card.state, 'approved');
    assert.equal((await call('GET', '/api/app/xo/approvals')).json.pendingCount, 0);

    const applied = await call('POST', `/api/app/xo/artifacts/${id}/apply`, {
      approvalId: next.approvalId,
    });
    assert.equal(applied.json.card.state, 'applied');
    const again = await call('POST', `/api/app/xo/artifacts/${id}/apply`, {
      approvalId: next.approvalId,
    });
    assert.equal(again.status, 200);

    const file = await call('GET', `/api/app/xo/artifacts/${id}/download`);
    assert.equal(file.status, 200);
    assert.match(file.headers['content-disposition'], /attachment; filename="llms\.txt"/);
    assert.match(file.body, /Boiler repairs/);
    const detail = await call('GET', `/api/app/xo/artifacts/${id}`);
    assert.deepEqual(detail.json.audit.map((e) => e.action).slice(-3), [
      'approved',
      'applied',
      'apply_duplicate',
    ]);
  });

  it('refuses a download before approval and a decision on changed content', async (t) => {
    const { call, card } = await setup(t);
    const id = card.artifact.artifactId;
    assert.equal((await call('GET', `/api/app/xo/artifacts/${id}/download`)).status, 400);
    const stale = await call('POST', `/api/app/xo/approvals/${card.artifact.approvalId}/decide`, {
      decision: 'reject',
      contentHash: 'a'.repeat(64),
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, 'stale_approval');
  });

  it('validates what an edit and a decision carry', async (t) => {
    const { call, card } = await setup(t);
    const id = card.artifact.artifactId;
    const edit = (json) => call('POST', `/api/app/xo/artifacts/${id}/edit`, json);
    assert.equal((await edit({})).json.error.issues[0].field, 'version');
    assert.equal((await edit({ version: 1, code: 42 })).status, 422);
    assert.equal((await edit({ version: 1, fill: { FILL_IN_X: 5 } })).status, 422);
    assert.equal((await edit({ version: 1, fill: ['no'] })).status, 422);
    assert.equal(
      (
        await call('POST', '/api/app/xo/approvals/1/decide', {
          decision: 'maybe',
          contentHash: 'a'.repeat(64),
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await call('POST', '/api/app/xo/approvals/1/decide', {
          decision: 'approve',
          contentHash: 'short',
        })
      ).status,
      422,
    );
  });

  it('lets a member edit but not decide', async (t) => {
    const { call, db, card, fill } = await setup(t);
    const edited = (await fill(1)).json.card.artifact;
    db.prepare("UPDATE memberships SET role = 'member'").run();
    const denied = await call('POST', `/api/app/xo/approvals/${edited.approvalId}/decide`, {
      decision: 'approve',
      contentHash: edited.contentHash,
    });
    assert.equal(denied.status, 403);
    const view = await call('GET', `/api/app/xo/artifacts/${card.artifact.artifactId}`);
    assert.deepEqual(view.json.card.actions, ['edit']);
  });

  it('keeps drafts inside their workspace', async (t) => {
    const { request, card } = await setup(t);
    const second = await request('POST', '/api/signup', {
      json: {
        name: 'Second',
        email: 'second@example.com',
        password: 'a long test password',
        workspaceName: 'Other Agency',
      },
    });
    const headers = { cookie: second.headers['set-cookie'][0].split(';')[0] };
    const id = card.artifact.artifactId;
    assert.equal((await request('GET', `/api/app/xo/artifacts/${id}`, { headers })).status, 404);
    assert.equal(
      (await request('GET', `/api/app/xo/artifacts/${id}/download`, { headers })).status,
      404,
    );
    assert.equal(
      (
        await request('POST', `/api/app/xo/approvals/${card.artifact.approvalId}/decide`, {
          headers,
          json: { decision: 'reject', contentHash: card.artifact.contentHash },
        })
      ).status,
      404,
    );
    assert.equal((await request('GET', '/api/app/xo/approvals', { headers })).json.pendingCount, 0);
  });
});
