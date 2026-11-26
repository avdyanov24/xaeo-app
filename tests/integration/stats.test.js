import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

// The sample engines only answer these questions, so a client that asks them gets real answers.
const QUESTIONS = [
  'Who is the best emergency plumber in Leeds?',
  'Which plumber should I call for a leaking boiler in Leeds?',
  'Who fits new bathrooms in Leeds?',
  'Who can unblock a drain in Leeds today?',
  'How do I find a trustworthy plumber in Leeds?',
];

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  /** Adds a client that asks the sample questions, scans it, and waits for the scan to finish. */
  const addScannedClient = async () => {
    const { json: created } = await call('POST', '/api/app/clients', {
      name: 'Northside Plumbing',
      domain: 'northsideplumbing.co.uk',
      questions: QUESTIONS.map((text) => ({ text })),
      scan: true,
    });
    const { json: client } = await call('GET', `/api/app/clients/${created.id}`);
    for (let tries = 0; tries < 200; tries++) {
      const { json } = await call('GET', `/api/app/scans/${client.runningId}`);
      if (json.state === 'done') return created.id;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('scan did not finish');
  };
  return { ...server, call, cookie, addScannedClient };
}

describe('GET /api/app/stats', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/stats')).status, 401);
  });

  it('counts nothing for an empty workspace', async (t) => {
    const { call } = await setup(t);
    const { status, json } = await call('GET', '/api/app/stats');
    assert.equal(status, 200);
    assert.equal(json.scanned, false);
    assert.equal(json.totals.ok, 0);
    assert.deepEqual(json.weeks, []);
    assert.equal(json.nextRescan, null);
    assert.equal(json.nextRescanCount, 0);
  });

  it('leaves the sample client out, so its numbers are never shown as the agency own', async (t) => {
    const { call } = await setup(t);
    await call('POST', '/api/app/sample');
    const { json } = await call('GET', '/api/app/stats');
    assert.equal(json.sampleExcluded, true);
    assert.equal(json.scanned, false);
    assert.equal(json.totals.ok, 0);
  });

  it('adds up the latest scan of the agency clients', async (t) => {
    const { call, addScannedClient } = await setup(t);
    await call('POST', '/api/app/sample');
    await addScannedClient();
    const { json } = await call('GET', '/api/app/stats');
    assert.equal(json.scanned, true);
    assert.equal(json.totals.ok, 10);
    assert.equal(json.totals.mentioned, 2);
    assert.deepEqual(
      json.byEngine.map((engine) => [engine.id, engine.ok]),
      [
        ['chatgpt', 5],
        ['claude', 5],
      ],
    );
    assert.equal(json.previous, null);
    assert.equal(json.weeks.length, 1);
    assert.equal(json.weeks[0].mentioned, 2);
    assert.ok(Date.parse(json.nextRescan) > Date.now());
    assert.equal(json.nextRescanCount, 1);
  });

  it('never counts another workspace clients', async (t) => {
    const owner = await setup(t);
    await owner.addScannedClient();
    const otherCookie = await owner.signIn();
    const { json } = await owner.request('GET', '/api/app/stats', {
      headers: { cookie: otherCookie },
    });
    assert.equal(json.scanned, false);
    assert.equal(json.totals.ok, 0);
  });
});
