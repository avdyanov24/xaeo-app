import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path) => server.request(method, path, { headers: { cookie } });
  const sample = (await call('POST', '/api/app/sample')).json.id;
  return { ...server, call, sample, cookie };
}

describe('client deletion routes', () => {
  it('require a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/lifecycle/clients/1')).status, 401);
    assert.equal((await request('POST', '/api/app/clients/1/deletion-request')).status, 401);
  });

  it('asks, shows the pending date, cancels, and asks again', async (t) => {
    const { call, sample } = await setup(t);
    const url = `/api/app/lifecycle/clients/${sample}`;
    assert.deepEqual((await call('GET', url)).json, { deletion: null });

    assert.equal((await call('POST', `${url}/deletion-request`)).status, 409, 'not archived yet');
    await call('POST', `/api/app/clients/${sample}/archive`);

    const asked = await call('POST', `/api/app/clients/${sample}/deletion-request`);
    assert.equal(asked.status, 200);
    const { requestedAt, executeAfter } = asked.json.deletion;
    assert.equal(Date.parse(executeAfter) - Date.parse(requestedAt), 7 * 24 * 60 * 60 * 1000);
    assert.deepEqual((await call('GET', url)).json, asked.json);
    assert.deepEqual((await call('POST', `${url}/deletion-request`)).json, asked.json);

    assert.deepEqual((await call('POST', `${url}/deletion-cancel`)).json, { deletion: null });
    assert.deepEqual((await call('GET', url)).json, { deletion: null });
  });

  it('drops the pending deletion when the client is unarchived', async (t) => {
    const { call, sample } = await setup(t);
    await call('POST', `/api/app/clients/${sample}/archive`);
    await call('POST', `/api/app/lifecycle/clients/${sample}/deletion-request`);
    await call('POST', `/api/app/clients/${sample}/unarchive`);
    assert.deepEqual((await call('GET', `/api/app/lifecycle/clients/${sample}`)).json, {
      deletion: null,
    });
  });

  it('are for the owner only', async (t) => {
    const { call, sample, db } = await setup(t);
    db.prepare("UPDATE memberships SET role = 'member'").run();
    const url = `/api/app/lifecycle/clients/${sample}`;
    assert.equal((await call('GET', url)).status, 403);
    assert.equal((await call('POST', `${url}/deletion-request`)).status, 403);
    assert.equal((await call('POST', `${url}/deletion-cancel`)).status, 403);
  });

  it("never reach another workspace's client", async (t) => {
    const { call, sample, request, signIn } = await setup(t);
    await call('POST', `/api/app/clients/${sample}/archive`);
    const outsider = await signIn();
    const as = (method, path) => request(method, path, { headers: { cookie: outsider } });
    const url = `/api/app/lifecycle/clients/${sample}`;
    assert.equal((await as('GET', url)).status, 404);
    assert.equal((await as('POST', `${url}/deletion-request`)).status, 404);
    assert.equal((await as('POST', `${url}/deletion-cancel`)).status, 404);
    assert.deepEqual((await call('GET', url)).json, { deletion: null });
  });
});
