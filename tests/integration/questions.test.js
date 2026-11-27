import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

const CLIENT = {
  name: 'Harbor Dental',
  domain: 'harbordental.co.uk',
  questions: [{ text: 'Who is the best emergency dentist in Bristol?', intent: 'urgent' }],
};

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  const { json } = await call('POST', '/api/app/clients', CLIENT);
  return { ...server, call, cookie, clientId: json.id };
}

describe('question routes', () => {
  it('requires a session', async (t) => {
    const { request, clientId } = await setup(t);
    assert.equal((await request('GET', `/api/app/clients/${clientId}/questions`)).status, 401);
    assert.equal((await request('POST', '/api/app/questions/1', { json: {} })).status, 401);
  });

  it('adds a question at the end and answers with the whole client', async (t) => {
    const { call, clientId } = await setup(t);
    const res = await call('POST', `/api/app/clients/${clientId}/questions`, {
      text: '  Which Bristol dentist is open on Sundays?  ',
    });
    assert.equal(res.status, 201);
    assert.deepEqual(
      res.json.questions.map(({ text, intent, active }) => ({ text, intent, active })),
      [
        { text: CLIENT.questions[0].text, intent: 'urgent', active: true },
        { text: 'Which Bristol dentist is open on Sundays?', intent: 'find', active: true },
      ],
    );
    const listed = await call('GET', `/api/app/clients/${clientId}/questions`);
    assert.equal(listed.json.length, 2);
  });

  it('rejects short text and an unknown intent', async (t) => {
    const { call, clientId } = await setup(t);
    const path = `/api/app/clients/${clientId}/questions`;
    const short = await call('POST', path, { text: 'hi' });
    assert.equal(short.status, 422);
    assert.equal(short.json.error.issues[0].field, 'text');
    assert.equal(
      (await call('POST', path, { text: 'A fair question', intent: 'buy' })).status,
      422,
    );
  });

  it('stops at 50 questions', async (t) => {
    const { call, clientId } = await setup(t);
    const path = `/api/app/clients/${clientId}/questions`;
    for (let n = 1; n < 50; n++)
      assert.equal((await call('POST', path, { text: `Question number ${n}` })).status, 201);
    const over = await call('POST', path, { text: 'One question too many' });
    assert.equal(over.status, 409);
    assert.equal(over.json.error.code, 'conflict');
  });

  it('edits text, intent and the on switch, one field at a time', async (t) => {
    const { call, clientId } = await setup(t);
    const [{ id }] = (await call('GET', `/api/app/clients/${clientId}/questions`)).json;
    const path = `/api/app/questions/${id}`;

    const reworded = await call('POST', path, { text: 'Who fixes a cracked tooth today?' });
    assert.equal(reworded.json.questions[0].text, 'Who fixes a cracked tooth today?');
    assert.equal(reworded.json.questions[0].intent, 'urgent');

    const paused = await call('PATCH', path, { active: false });
    assert.equal(paused.json.questions[0].active, false);

    const retyped = await call('POST', path, { intent: 'trust' });
    assert.equal(retyped.json.questions[0].intent, 'trust');
    assert.equal(retyped.json.questions[0].active, false);
  });

  it('deletes a question from the list', async (t) => {
    const { call, clientId } = await setup(t);
    const added = await call('POST', `/api/app/clients/${clientId}/questions`, {
      text: 'A question to remove',
    });
    const doomed = added.json.questions.at(-1).id;

    const res = await call('POST', `/api/app/questions/${doomed}/delete`, {});
    assert.equal(res.status, 200);
    assert.equal(res.json.questions.length, 1);
    assert.equal((await call('POST', `/api/app/questions/${doomed}/delete`, {})).status, 404);
    assert.equal((await call('DELETE', `/api/app/questions/${doomed}`)).status, 404);
  });

  it('keeps questions private to their workspace', async (t) => {
    const { call, request, signIn, clientId } = await setup(t);
    const [{ id }] = (await call('GET', `/api/app/clients/${clientId}/questions`)).json;

    const cookie = await signIn();
    const other = (method, path, json) => request(method, path, { headers: { cookie }, json });
    assert.equal((await other('GET', `/api/app/clients/${clientId}/questions`)).status, 404);
    assert.equal(
      (await other('POST', `/api/app/clients/${clientId}/questions`, { text: 'Sneaky question' }))
        .status,
      404,
    );
    assert.equal((await other('POST', `/api/app/questions/${id}`, { active: false })).status, 404);
    assert.equal((await other('POST', `/api/app/questions/${id}/delete`, {})).status, 404);
    assert.equal(
      (await call('GET', `/api/app/clients/${clientId}/questions`)).json[0].active,
      true,
    );
  });
});

describe('GET /api/app/suggest', () => {
  it('requires a session', async (t) => {
    const { request } = await startTestServer(t);
    assert.equal((await request('GET', '/api/app/suggest?name=Acme')).status, 401);
  });

  it('suggests questions for a client that does not exist yet', async (t) => {
    const { request, signIn } = await startTestServer(t);
    const cookie = await signIn();
    const res = await request(
      'GET',
      '/api/app/suggest?name=Northside%20Plumbing&type=Plumber&city=Leeds',
      { headers: { cookie } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.questions.length, 6);
    assert.equal(res.json.questions[0].text, 'Who is the best plumber in Leeds?');
    assert.deepEqual(Object.keys(res.json.questions[0]).sort(), ['intent', 'on', 'text']);
  });

  it('answers 422 without a name, or with one that is too long', async (t) => {
    const { request, signIn } = await startTestServer(t);
    const cookie = await signIn();
    for (const query of ['', '?type=Plumber', `?name=${'x'.repeat(101)}`])
      assert.equal(
        (await request('GET', `/api/app/suggest${query}`, { headers: { cookie } })).status,
        422,
        query,
      );
  });
});
