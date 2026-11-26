import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  const sample = (await call('POST', '/api/app/sample')).json.id;
  return { ...server, call, cookie, sample };
}

/** The cells of a grid as one flat list. */
const allCells = (grid) => Object.values(grid.cells).flatMap((row) => Object.values(row));

describe('GET /api/app/clients/:id/answers', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/clients/1/answers')).status, 401);
  });

  it('draws the Northside grid: 5 questions by 2 engines, named in 2 of 10', async (t) => {
    const { call, sample } = await setup(t);
    const { status, json: grid } = await call('GET', `/api/app/clients/${sample}/answers`);
    assert.equal(status, 200);
    assert.deepEqual(
      grid.engines.map((engine) => engine.id),
      ['chatgpt', 'claude'],
    );
    assert.equal(grid.questions.length, 5);
    assert.equal(grid.scan.number, 1);
    assert.equal(grid.scan.status, 'done');
    assert.equal(grid.scan.ok, 10);
    assert.equal(grid.scan.mentioned, 2);
    assert.equal(allCells(grid).length, 10);
    assert.equal(allCells(grid).filter((cell) => cell.label !== 'Not mentioned').length, 2);
    for (const question of grid.questions)
      assert.deepEqual(Object.keys(grid.cells[question.id]).sort(), ['chatgpt', 'claude']);
    assert.ok(allCells(grid).every((cell) => typeof cell.id === 'string'));
  });

  it('lists the scan history for the picker and says the first scan is a baseline', async (t) => {
    const { call, sample } = await setup(t);
    const { json: grid } = await call('GET', `/api/app/clients/${sample}/answers`);
    assert.equal(grid.scans.length, 1);
    assert.equal(grid.scans[0].id, grid.scan.id);
    assert.equal(grid.scan.comparisonToPrevious.comparable, false);
    assert.equal(grid.scan.configuration.state, 'recorded');
    assert.equal(grid.scan.configuration.source, 'sample');
  });

  it('opens an older scan with ?scan= and compares a repeat scan with the one before', async (t) => {
    const { call, sample } = await setup(t);
    const first = (await call('GET', `/api/app/clients/${sample}/answers`)).json.scan.id;
    const { json: started } = await call('POST', `/api/app/clients/${sample}/scans`);
    for (let tries = 0; tries < 200; tries++) {
      const { json } = await call('GET', `/api/app/scans/${started.id}`);
      if (json.state === 'done') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const latest = (await call('GET', `/api/app/clients/${sample}/answers`)).json;
    assert.equal(latest.scan.id, started.id);
    assert.equal(latest.scans.length, 2);
    assert.equal(latest.scan.comparisonToPrevious.comparable, true);

    const older = (await call('GET', `/api/app/clients/${sample}/answers?scan=${first}`)).json;
    assert.equal(older.scan.id, first);
    assert.equal(older.scan.number, 1);
  });

  it('returns an empty grid for a client that has not been scanned', async (t) => {
    const { call } = await setup(t);
    const { json: created } = await call('POST', '/api/app/clients', {
      name: 'Unscanned Ltd',
      domain: 'unscanned.example.com',
    });
    const { status, json } = await call('GET', `/api/app/clients/${created.id}/answers`);
    assert.equal(status, 200);
    assert.equal(json.scan, null);
    assert.deepEqual(json.scans, []);
    assert.deepEqual(json.cells, {});
  });

  it('answers 404 for a missing scan, a malformed one and an unknown client', async (t) => {
    const { call, sample } = await setup(t);
    assert.equal((await call('GET', `/api/app/clients/${sample}/answers?scan=9999`)).status, 404);
    assert.equal((await call('GET', `/api/app/clients/${sample}/answers?scan=abc`)).status, 404);
    assert.equal((await call('GET', '/api/app/clients/9999/answers')).status, 404);
  });

  it('never shows one workspace the answers of another', async (t) => {
    const owner = await setup(t);
    const otherCookie = await owner.signIn();
    const other = (method, path) =>
      owner.request(method, path, { headers: { cookie: otherCookie } });
    const scanId = (await owner.call('GET', `/api/app/clients/${owner.sample}/answers`)).json.scan
      .id;
    assert.equal((await other('GET', `/api/app/clients/${owner.sample}/answers`)).status, 404);
    // A scan id from another workspace is as good as a missing one, even through a client of one's own.
    const mine = (await other('POST', '/api/app/sample')).json.id;
    assert.equal(
      (await other('GET', `/api/app/clients/${mine}/answers?scan=${scanId}`)).status,
      404,
    );
  });
});
