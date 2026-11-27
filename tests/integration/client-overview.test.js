import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  const sample = (await call('POST', '/api/app/sample')).json.id;
  const detail = async () => (await call('GET', `/api/app/clients/${sample}`)).json;
  return { ...server, call, detail, sample };
}

describe('client overview fields on GET /api/app/clients/:id', () => {
  it('reports the Northside baseline: 2 of 10, per engine, with rivals and sources', async (t) => {
    const { detail } = await setup(t);
    const client = await detail();

    assert.equal(client.scans.length, 1);
    assert.equal(client.latestScanId, client.scans[0].id);
    assert.equal(typeof client.latest.finishedAt, 'number');
    assert.equal(client.kpis.ok, 10);
    assert.equal(client.kpis.mentioned, 2);
    assert.deepEqual(
      client.engines.map(({ id, ok }) => [id, ok]),
      [
        ['chatgpt', 5],
        ['claude', 5],
      ],
    );
    assert.equal(
      client.engines.reduce((sum, engine) => sum + engine.mentioned, 0),
      2,
    );
    assert.ok(client.competitors.length > 0);
    assert.ok(client.sources.length > 0);
    assert.equal(client.failed, 0);
    assert.equal(client.skipped, 0);
  });

  it('starts a baseline with nothing to compare on the first scan', async (t) => {
    const { detail } = await setup(t);
    const client = await detail();

    assert.equal(client.comparison, null);
    assert.deepEqual(client.changes, { gained: [], lost: [] });
    assert.equal(client.comparisonAvailability.comparable, false);
    assert.equal(client.latestConfiguration.source, 'sample');
  });

  it('suggests the first open fix and estimates what the fixes would win back', async (t) => {
    const { detail } = await setup(t);
    const client = await detail();

    assert.equal(client.topFix.status, 'todo');
    assert.equal(client.estimate.current, 2);
    assert.ok(client.estimate.projected > client.estimate.current);
    assert.equal(client.doneMarkers.length, client.fixes.done);
    for (const marker of client.doneMarkers) {
      assert.equal(typeof marker.doneAt, 'number');
      assert.ok(marker.title);
    }
  });

  it('lists a client with no scan with every engine at zero', async (t) => {
    const { call } = await setup(t);
    const { json: created } = await call('POST', '/api/app/clients', {
      name: 'Harbor Dental',
      domain: 'harbordental.co.uk',
      questions: [{ text: 'Who is the best dentist in Bristol?' }],
    });
    const { json: client } = await call('GET', `/api/app/clients/${created.id}`);

    assert.deepEqual(client.scans, []);
    assert.equal(client.latest, null);
    assert.equal(client.kpis, null);
    assert.deepEqual(
      client.engines.map(({ id, ok, mentioned }) => [id, ok, mentioned]),
      [
        ['chatgpt', 0, 0],
        ['claude', 0, 0],
      ],
    );
    assert.equal(client.latestScanId, null);
    assert.equal(client.estimate, null);
  });

  it('still requires a session', async (t) => {
    const { request, sample } = await setup(t);
    assert.equal((await request('GET', `/api/app/clients/${sample}`)).status, 401);
  });
});
