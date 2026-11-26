import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

async function setup(t, appOptions) {
  const server = await startTestServer(t, {}, appOptions);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  /** Polls until the scan stops changing, so no scan is still writing when the test ends. */
  const settle = async (id) => {
    for (let tries = 0; tries < 200; tries++) {
      const { json } = await call('GET', `/api/app/scans/${id}`);
      if (!['queued', 'running'].includes(json.state)) return json;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('scan did not finish');
  };
  const sample = (await call('POST', '/api/app/sample')).json.id;
  return { ...server, call, cookie, settle, sample };
}

describe('scan routes', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('POST', '/api/app/clients/1/scans')).status, 401);
    assert.equal((await request('GET', '/api/app/scans/1')).status, 401);
  });

  it('runs a scan from queued to done and shows it on the client', async (t) => {
    const { call, settle, sample } = await setup(t);
    const started = await call('POST', `/api/app/clients/${sample}/scans`);
    assert.equal(started.status, 201);
    assert.equal(started.json.state, 'queued');
    assert.equal(started.json.number, 2);
    assert.equal(started.json.total, 10);

    const mid = (await call('GET', `/api/app/clients/${sample}`)).json;
    assert.equal(mid.runningId, started.json.id);

    const done = await settle(started.json.id);
    assert.equal(done.state, 'done');
    assert.equal(done.completed, 10);
    assert.equal(done.ok + done.failed, 10);

    const client = (await call('GET', `/api/app/clients/${sample}`)).json;
    assert.equal(client.runningId, null);
    assert.equal(client.latest.id, started.json.id);
    assert.equal(client.scans.length, 2);
  });

  it('refuses a second scan while one is running, and a client with no questions on', async (t) => {
    const { call, settle, sample } = await setup(t, { scanStepDelayMs: 20 });
    const first = await call('POST', `/api/app/clients/${sample}/scans`);
    const second = await call('POST', `/api/app/clients/${sample}/scans`);
    assert.equal(second.status, 409);
    await call('POST', `/api/app/scans/${first.json.id}/cancel`);
    await settle(first.json.id);

    const { json: empty } = await call('POST', '/api/app/clients', {
      name: 'No Questions Ltd',
      domain: 'noquestions.example.com',
    });
    const none = await call('POST', `/api/app/clients/${empty.id}/scans`);
    assert.equal(none.status, 400);
  });

  it('cancels a running scan, keeps its answers, and retries it from the start', async (t) => {
    const { call, settle, sample } = await setup(t, { scanStepDelayMs: 20 });
    const { json: started } = await call('POST', `/api/app/clients/${sample}/scans`);
    const cancelled = await call('POST', `/api/app/scans/${started.id}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.state, 'cancelled');
    await settle(started.id);
    assert.equal((await call('POST', `/api/app/scans/${started.id}/cancel`)).status, 409);

    const retried = await call('POST', `/api/app/scans/${started.id}/retry`);
    assert.equal(retried.status, 200);
    assert.equal(retried.json.state, 'queued');
    assert.equal(retried.json.completed, 0);
    const done = await settle(started.id);
    assert.equal(done.state, 'done');
    assert.equal((await call('POST', `/api/app/scans/${started.id}/retry`)).status, 409);
  });

  it('starts the first scan when a client is created with scan true', async (t) => {
    const { call, settle } = await setup(t);
    const withScan = await call('POST', '/api/app/clients', {
      name: 'Harbor Dental',
      domain: 'harbordental.co.uk',
      questions: [{ text: 'Who is the best dentist in Bristol?' }],
      scan: true,
    });
    assert.equal(withScan.status, 201);
    assert.equal(withScan.json.scanNote, undefined);
    const { json: client } = await call('GET', `/api/app/clients/${withScan.json.id}`);
    assert.equal(client.scans.length, 1);
    await settle(client.scans[0].id);

    const noQuestions = await call('POST', '/api/app/clients', {
      name: 'Empty Co',
      domain: 'empty.example.com',
      scan: true,
    });
    assert.equal(noQuestions.status, 201);
    assert.match(noQuestions.json.scanNote, /at least one question/);
  });

  it('keeps scans private to their workspace', async (t) => {
    const { call, request, signIn, settle, sample } = await setup(t);
    const { json: scan } = await call('POST', `/api/app/clients/${sample}/scans`);

    const cookie = await signIn();
    const other = (method, path) => request(method, path, { headers: { cookie } });
    assert.equal((await other('POST', `/api/app/clients/${sample}/scans`)).status, 404);
    assert.equal((await other('GET', `/api/app/scans/${scan.id}`)).status, 404);
    assert.equal((await other('POST', `/api/app/scans/${scan.id}/cancel`)).status, 404);
    assert.equal((await other('POST', `/api/app/scans/${scan.id}/retry`)).status, 404);
    assert.equal((await settle(scan.id)).state, 'done');
  });
});
