import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

const NEW_CLIENT = {
  name: 'Harbor Dental',
  domain: 'https://www.HarborDental.co.uk/contact',
  type: 'Dentist',
  city: 'Bristol',
  country: 'gb',
  questions: [
    { text: 'Who is the best emergency dentist in Bristol?', intent: 'urgent' },
    { text: 'Which Bristol dentist takes new NHS patients?' },
  ],
};

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  return { ...server, call };
}

describe('client routes', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/clients')).status, 401);
    assert.equal((await request('POST', '/api/app/clients', { json: NEW_CLIENT })).status, 401);
  });

  it('creates a client with a bare domain, capital country code and its questions', async (t) => {
    const { call } = await setup(t);
    const created = await call('POST', '/api/app/clients', NEW_CLIENT);
    assert.equal(created.status, 201);

    const { json: client } = await call('GET', `/api/app/clients/${created.json.id}`);
    assert.equal(client.domain, 'harbordental.co.uk');
    assert.equal(client.country, 'GB');
    assert.deepEqual(
      client.questions.map(({ text, intent, active }) => ({ text, intent, active })),
      [
        { text: NEW_CLIENT.questions[0].text, intent: 'urgent', active: true },
        { text: NEW_CLIENT.questions[1].text, intent: 'find', active: true },
      ],
    );
    assert.deepEqual(client.scans, []);
    assert.equal(client.status, 'active');
    assert.equal(client.weekly, true);
    assert.equal(client.latest, null);
    assert.equal(client.running, null);
  });

  it('rejects a missing name, a bad domain and a short question with 422', async (t) => {
    const { call } = await setup(t);
    const noName = await call('POST', '/api/app/clients', { ...NEW_CLIENT, name: '' });
    assert.equal(noName.status, 422);
    assert.equal(noName.json.error.issues[0].field, 'name');

    const badDomain = await call('POST', '/api/app/clients', {
      ...NEW_CLIENT,
      domain: 'localhost',
    });
    assert.equal(badDomain.status, 422);

    const shortQuestion = await call('POST', '/api/app/clients', {
      ...NEW_CLIENT,
      questions: [{ text: 'hi' }],
    });
    assert.equal(shortQuestion.status, 422);
    assert.equal((await call('GET', '/api/app/clients')).json.clients.length, 0);
  });

  it('lists active clients, and archived ones with ?archived=1', async (t) => {
    const { call } = await setup(t);
    const { json: first } = await call('POST', '/api/app/clients', NEW_CLIENT);
    await call('POST', '/api/app/clients', { ...NEW_CLIENT, name: 'Second Client' });

    assert.equal((await call('POST', `/api/app/clients/${first.id}/archive`)).status, 204);

    const active = (await call('GET', '/api/app/clients')).json;
    assert.deepEqual(
      active.clients.map((client) => client.name),
      ['Second Client'],
    );
    assert.equal(active.archivedCount, 1);

    const archived = (await call('GET', '/api/app/clients?archived=1')).json;
    assert.equal(archived.clients[0].status, 'archived');
    assert.equal(archived.clients[0].weekly, false);

    assert.equal((await call('POST', `/api/app/clients/${first.id}/unarchive`)).status, 204);
    assert.equal((await call('GET', '/api/app/clients')).json.clients.length, 2);
  });

  it('updates only the fields sent, and switches the weekly rescan', async (t) => {
    const { call } = await setup(t);
    const { json: created } = await call('POST', '/api/app/clients', NEW_CLIENT);
    const path = `/api/app/clients/${created.id}`;

    const renamed = await call('POST', path, { name: 'Harbor Dental Care' });
    assert.equal(renamed.json.name, 'Harbor Dental Care');
    assert.equal(renamed.json.city, 'Bristol');

    const off = await call('PATCH', path, { weekly: false });
    assert.equal(off.json.weekly, false);
    assert.equal(off.json.nextRunAt, null);

    assert.equal((await call('POST', path, { domain: 'nope' })).status, 422);
  });

  it('keeps clients private to their workspace', async (t) => {
    const { call, request, signIn } = await setup(t);
    const { json: created } = await call('POST', '/api/app/clients', NEW_CLIENT);

    const otherCookie = await signIn();
    const other = (method, path, json) =>
      request(method, path, { headers: { cookie: otherCookie }, json });
    assert.deepEqual((await other('GET', '/api/app/clients')).json.clients, []);
    assert.equal((await other('GET', `/api/app/clients/${created.id}`)).status, 404);
    assert.equal(
      (await other('POST', `/api/app/clients/${created.id}`, { name: 'Taken' })).status,
      404,
    );
    assert.equal((await other('POST', `/api/app/clients/${created.id}/archive`)).status, 404);
    assert.equal((await call('GET', `/api/app/clients/${created.id}`)).json.name, 'Harbor Dental');
  });

  it('returns 404 for an id that is not a number', async (t) => {
    const { call } = await setup(t);
    assert.equal((await call('GET', '/api/app/clients/abc')).status, 404);
    assert.equal((await call('GET', '/api/app/clients/0')).status, 404);
  });

  it('adds the Northside example once and shows it named in 2 of 10 answers', async (t) => {
    const { call } = await setup(t);
    const first = await call('POST', '/api/app/sample');
    assert.equal(first.status, 201);
    const again = await call('POST', '/api/app/sample');
    assert.equal(again.status, 200);
    assert.equal(again.json.id, first.json.id);

    const { json } = await call('GET', '/api/app/clients');
    assert.equal(json.clients.length, 1);
    const [northside] = json.clients;
    assert.equal(northside.sample, true);
    assert.equal(northside.questions, 5);
    assert.deepEqual(
      { ok: northside.latest.ok, mentioned: northside.latest.mentioned },
      { ok: 10, mentioned: 2 },
    );
  });
});
