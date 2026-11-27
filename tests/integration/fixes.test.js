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

  it('counts the fixes on the client, so the tabs and the list show how many are open', async (t) => {
    const { call, sample } = await setup(t);
    const counts = { todo: 3, done: 1, wont: 0, total: 4 };
    assert.deepEqual((await call('GET', `/api/app/clients/${sample}`)).json.fixes, counts);
    const listed = (await call('GET', '/api/app/clients')).json.clients;
    assert.deepEqual(listed[0].fixes, counts);

    const { json } = await call('GET', `/api/app/clients/${sample}/fixes`);
    await call('POST', `/api/app/fixes/${json.fixes[1].id}/status`, { status: 'wont' });
    assert.deepEqual((await call('GET', `/api/app/clients/${sample}`)).json.fixes, {
      todo: 2,
      done: 1,
      wont: 1,
      total: 4,
    });
  });

  it('downloads the fixes as a CSV attachment', async (t) => {
    const { call, sample } = await setup(t);
    const res = await call('GET', `/api/app/clients/${sample}/fixes.csv`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(
      res.headers['content-disposition'],
      'attachment; filename="Northside Plumbing fixes.csv"',
    );
    assert.equal(res.headers['cache-control'], 'no-store');
    const lines = res.body.split('\r\n');
    assert.ok(lines[0].startsWith('\uFEFFFix ID,Title,Client,'));
    assert.ok(res.body.includes('Add LocalBusiness structured data to the home page'));
    assert.ok(res.body.endsWith('\r\n'));
  });

  it('records a CSV handoff, then leaves the exported fixes out of only=new', async (t) => {
    const { call, sample } = await setup(t);
    const url = `/api/app/clients/${sample}`;
    assert.deepEqual((await call('GET', `${url}/handoffs`)).json, { handoffs: [] });

    const recorded = await call('POST', `${url}/handoffs`, { fixIds: ['1', '2'], channel: 'csv' });
    assert.deepEqual(recorded.json, { recorded: 2 });

    const { handoffs } = (await call('GET', `${url}/handoffs`)).json;
    assert.deepEqual(
      handoffs.map((h) => [h.fixId, h.csv.state, h.csv.count]),
      [
        ['1', 'sent', 1],
        ['2', 'sent', 1],
      ],
    );
    const fresh = await call('GET', `${url}/fixes.csv?only=new`);
    const ids = fresh.body
      .split('\r\n')
      .slice(1, -1)
      .map((line) => line.split(',')[0]);
    assert.deepEqual(ids, ['3', '4']);

    await call('POST', `/api/app/fixes/2/status`, { status: 'done' });
    const changed = (await call('GET', `${url}/handoffs`)).json.handoffs;
    assert.equal(changed.find((h) => h.fixId === '2').csv.state, 'changed');
  });

  it('rejects a malformed handoff and records nothing for a fix that is not the client’s', async (t) => {
    const { call, sample } = await setup(t);
    const url = `/api/app/clients/${sample}/handoffs`;
    for (const body of [
      { fixIds: [], channel: 'csv' },
      { fixIds: ['1'], channel: 'email' },
      { fixIds: [1], channel: 'csv' },
      { fixIds: ['abc'], channel: 'csv' },
      { fixIds: Array.from({ length: 101 }, (_, i) => String(i + 1)), channel: 'csv' },
      { channel: 'csv' },
    ])
      assert.equal((await call('POST', url, body)).status, 422, JSON.stringify(body).slice(0, 60));
    assert.equal((await call('POST', url, { fixIds: ['1', '999'], channel: 'csv' })).status, 404);
    assert.deepEqual((await call('GET', url)).json, { handoffs: [] });
  });

  it("keeps another workspace out of a client's CSV and handoffs", async (t) => {
    const { sample, request, signIn } = await setup(t);
    const outsider = await signIn();
    const as = (method, path, json) =>
      request(method, path, { headers: { cookie: outsider }, json });
    assert.equal((await as('GET', `/api/app/clients/${sample}/fixes.csv`)).status, 404);
    assert.equal((await as('GET', `/api/app/clients/${sample}/handoffs`)).status, 404);
    const post = await as('POST', `/api/app/clients/${sample}/handoffs`, {
      fixIds: ['1'],
      channel: 'csv',
    });
    assert.equal(post.status, 404);
    const anon = (path) => request('GET', path);
    assert.equal((await anon(`/api/app/clients/${sample}/fixes.csv`)).status, 401);
  });
});
