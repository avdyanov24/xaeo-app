import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  const sample = (await call('POST', '/api/app/sample')).json.id;
  return { ...server, call, sample };
}

const VERIFY = {
  beforeObservationId: 'obs-1',
  afterObservationId: 'obs-2',
  targetUrl: 'https://northsideplumbing.co.uk/',
  condition: { kind: 'title', value: 'Northside Plumbing' },
  reviewed: true,
};

describe('fix routes', () => {
  it('require a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/clients/1/fixes')).status, 401);
    assert.equal((await request('POST', '/api/app/fixes/1/status')).status, 401);
    assert.equal((await request('POST', '/api/app/fixes/1/verify')).status, 401);
  });

  it("lists Northside's four fixes with their labels and the estimate", async (t) => {
    const { call, sample } = await setup(t);
    const { status, json } = await call('GET', `/api/app/clients/${sample}/fixes`);
    assert.equal(status, 200);
    assert.deepEqual(
      json.fixes.map((fix) => [fix.status, fix.impact, fix.evidence]),
      [
        ['done', 'High', 'Strong'],
        ['todo', 'High', 'Medium'],
        ['todo', 'Medium', 'Strong'],
        ['todo', 'Medium', 'Strong'],
      ],
    );
    assert.deepEqual(json.estimate, { current: 2, total: 10, projected: 6 });
    assert.equal(json.fixes[1].evidenceAnswers[0].label, 'Not mentioned');
    assert.deepEqual(json.fixes[2].engines, ['ChatGPT', 'Claude']);
    assert.equal(json.allDone, false);
    assert.ok(json.definitions.impact.High);
  });

  it('keeps a status change across a reload, and undoes it', async (t) => {
    const { call, sample } = await setup(t);
    const [, second] = (await call('GET', `/api/app/clients/${sample}/fixes`)).json.fixes;

    const done = await call('POST', `/api/app/fixes/${second.id}/status`, { status: 'done' });
    assert.equal(done.status, 200);
    assert.equal(done.json.fixes[1].status, 'done');
    assert.ok(done.json.fixes[1].doneAt);

    const reloaded = (await call('GET', `/api/app/clients/${sample}/fixes`)).json;
    assert.equal(reloaded.fixes[1].status, 'done');
    assert.equal(reloaded.fixes[1].doneAt, done.json.fixes[1].doneAt);

    const reopened = await call('POST', `/api/app/fixes/${second.id}/status`, { status: 'todo' });
    assert.equal(reopened.json.fixes[1].status, 'todo');
    assert.equal(reopened.json.fixes[1].doneAt, null);
  });

  it('reports allDone once every fix is done', async (t) => {
    const { call, sample } = await setup(t);
    const { fixes } = (await call('GET', `/api/app/clients/${sample}/fixes`)).json;
    let last;
    for (const fix of fixes)
      last = await call('POST', `/api/app/fixes/${fix.id}/status`, { status: 'done' });
    assert.equal(last.json.allDone, true);
  });

  it('rejects an unknown status and an id that is not a number', async (t) => {
    const { call, sample } = await setup(t);
    const { json } = await call('GET', `/api/app/clients/${sample}/fixes`);
    const bad = await call('POST', `/api/app/fixes/${json.fixes[0].id}/status`, {
      status: 'finished',
    });
    assert.equal(bad.status, 422);
    assert.equal(bad.json.error.code, 'validation_failed');
    assert.equal((await call('POST', '/api/app/fixes/abc/status', { status: 'done' })).status, 404);
    assert.equal((await call('GET', '/api/app/clients/abc/fixes')).status, 404);
  });

  it("never shows or changes another workspace's fixes", async (t) => {
    const { call, sample, request, signIn } = await setup(t);
    const { json } = await call('GET', `/api/app/clients/${sample}/fixes`);
    const outsider = await signIn();
    const as = (method, path, body) =>
      request(method, path, { headers: { cookie: outsider }, json: body });
    assert.equal((await as('GET', `/api/app/clients/${sample}/fixes`)).status, 404);
    const attempt = await as('POST', `/api/app/fixes/${json.fixes[1].id}/status`, {
      status: 'done',
    });
    assert.equal(attempt.status, 404);
    assert.equal(
      (await as('POST', `/api/app/fixes/${json.fixes[1].id}/verify`, VERIFY)).status,
      404,
    );
    const after = (await call('GET', `/api/app/clients/${sample}/fixes`)).json;
    assert.equal(after.fixes[1].status, 'todo');
  });

  it('refuses to compare observations because none are saved', async (t) => {
    const { call, sample } = await setup(t);
    const { json } = await call('GET', `/api/app/clients/${sample}/fixes`);
    const id = json.fixes[1].id;
    assert.equal(json.fixes[1].canVerify, false);

    const refused = await call('POST', `/api/app/fixes/${id}/verify`, VERIFY);
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.code, 'conflict');

    const unchecked = await call('POST', `/api/app/fixes/${id}/verify`, {
      ...VERIFY,
      reviewed: false,
    });
    assert.equal(unchecked.status, 422);
    const noCondition = await call('POST', `/api/app/fixes/${id}/verify`, {
      ...VERIFY,
      condition: { kind: 'colour', value: '' },
    });
    assert.equal(noCondition.status, 422);
  });
});
