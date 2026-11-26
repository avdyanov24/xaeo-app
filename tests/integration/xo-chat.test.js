import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer } from '../helpers/server.js';

/** Splits a text/event-stream body into `{ event, data }` frames. */
function parseStream(body) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const event = lines.find((l) => l.startsWith('event: ')).slice(7);
      const data = JSON.parse(lines.find((l) => l.startsWith('data: ')).slice(6));
      return { event, data };
    });
}

async function setup(t) {
  const server = await startTestServer(t);
  const cookie = await server.signIn();
  const call = (method, path, json) => server.request(method, path, { headers: { cookie }, json });
  await call('POST', '/api/app/sample');
  const turn = async (json) => {
    const res = await call('POST', '/api/app/xo/turn', json);
    return { ...res, events: res.status === 200 ? parseStream(res.body) : [] };
  };
  return { ...server, call, cookie, turn };
}

describe('xo chat routes', () => {
  it('require a session', async (t) => {
    const { request } = await setup(t);
    assert.equal((await request('POST', '/api/app/xo/turn', { json: { text: 'hi' } })).status, 401);
    for (const path of ['conversations', 'conversations/1', 'suggestions', 'usage'])
      assert.equal((await request('GET', `/api/app/xo/${path}`)).status, 401, path);
  });

  it('streams a reply as server-sent events with the example client numbers', async (t) => {
    const { turn } = await setup(t);
    const res = await turn({ text: 'Why is this client missing from AI answers?' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/event-stream/);
    const kinds = res.events.map((e) => e.event);
    assert.equal(kinds[0], 'start');
    assert.equal(kinds.at(-1), 'done');
    const text = res.events
      .filter((e) => e.event === 'text')
      .map((e) => e.data.delta)
      .join('');
    assert.match(text, /Northside Plumbing is named in 2 of 10 answers/);
    assert.match(res.events.find((e) => e.event === 'ui').data.hash, /^#\/clients\/\d+\/answers$/);
  });

  it('refuses an empty or oversized message before the stream starts', async (t) => {
    const { turn } = await setup(t);
    const empty = await turn({ text: '   ' });
    assert.equal(empty.status, 422);
    assert.equal(empty.json.error.issues[0].field, 'text');
    assert.equal((await turn({ text: 'x'.repeat(4001) })).status, 422);
    assert.equal((await turn({ text: 'hi', conversationId: 'abc' })).status, 422);
  });

  it('lists the chat after a turn and reads it back with its messages', async (t) => {
    const { turn, call } = await setup(t);
    const { events } = await turn({ text: 'Draft an llms.txt' });
    const id = events[0].data.conversationId;
    const list = await call('GET', '/api/app/xo/conversations');
    assert.deepEqual(
      list.json.conversations.map((c) => [c.id, c.title, c.status]),
      [[id, 'Draft an llms.txt', 'open']],
    );
    const chat = await call('GET', `/api/app/xo/conversations/${id}`);
    assert.deepEqual(
      chat.json.messages.map((m) => m.role),
      ['user', 'assistant'],
    );
    assert.equal(chat.json.cards[0].card.artifact.kind, 'llms_txt');
  });

  it('keeps a chat to its owner and answers 404 to anyone else', async (t) => {
    const { turn, request, call } = await setup(t);
    const id = (await turn({ text: 'hello' })).events[0].data.conversationId;
    const second = await request('POST', '/api/signup', {
      json: {
        name: 'Second',
        email: 'second@example.com',
        password: 'a long test password',
        workspaceName: 'Other Agency',
      },
    });
    const other = second.headers['set-cookie'][0].split(';')[0];
    const peek = await request('GET', `/api/app/xo/conversations/${id}`, {
      headers: { cookie: other },
    });
    assert.equal(peek.status, 404);
    const send = await request('POST', '/api/app/xo/turn', {
      headers: { cookie: other },
      json: { text: 'hi', conversationId: id },
    });
    assert.equal(send.status, 404);
    assert.equal((await call('GET', `/api/app/xo/conversations/${id}`)).status, 200);
  });

  it('offers suggestions about the open client and reports no limit', async (t) => {
    const { call } = await setup(t);
    const { json } = await call('GET', '/api/app/xo/suggestions');
    assert.match(json.suggestions[0].message, /Why is Northside Plumbing missing/);
    assert.deepEqual((await call('GET', '/api/app/xo/usage')).json, {
      blocked: null,
      rateLimit: null,
    });
  });

  it('dismisses a scan card once and refuses a second time', async (t) => {
    const { turn, call, request } = await setup(t);
    const { events } = await turn({ text: 'run a scan' });
    const { cardId } = events.find((e) => e.event === 'card').data.card;
    const first = await call('POST', `/api/app/xo/cards/${cardId}/dismiss`);
    assert.equal(first.json.card.state, 'dismissed');
    assert.equal((await call('POST', `/api/app/xo/cards/${cardId}/dismiss`)).status, 409);
    assert.equal((await call('POST', '/api/app/xo/cards/card-999/dismiss')).status, 404);
    assert.equal((await request('POST', `/api/app/xo/cards/${cardId}/dismiss`)).status, 401);
  });

  it('closes the open scan cards of a client when a scan starts another way', async (t) => {
    const { turn, call } = await setup(t);
    const { events } = await turn({ text: 'run a scan' });
    const card = events.find((e) => e.event === 'card').data.card;
    const started = await call('POST', `/api/app/clients/${card.clientId}/scans`);
    assert.equal(started.status, 201);
    const chat = await call('GET', `/api/app/xo/conversations/${events[0].data.conversationId}`);
    assert.equal(chat.json.cards[0].card.state, 'done');
    assert.deepEqual(chat.json.cards[0].card.actions, []);
  });
});
