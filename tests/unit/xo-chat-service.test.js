import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import { createClientService } from '../../src/server/services/client-service.js';
import { addSampleClient } from '../../src/server/services/sample-client.js';
import { createArtifactService } from '../../src/server/services/xo/artifact-service.js';
import { MAX_MESSAGES, createChatService } from '../../src/server/services/xo/chat-service.js';

const owner = { user: { id: 1, name: 'Owner' }, workspace: { id: 1, role: 'owner' } };
const other = { user: { id: 2, name: 'Other' }, workspace: { id: 1, role: 'member' } };

async function setup({ withClient = true } = {}) {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO workspaces (id, name) VALUES (1, 'Brightline Digital');
    INSERT INTO users (id, email, name, password_hash) VALUES (1, 'o@one.test', 'Owner', 'x'), (2, 'm@one.test', 'Other', 'x');
  `);
  const sample = withClient ? await addSampleClient(db, 1) : null;
  const clientService = createClientService({ db });
  const artifactService = createArtifactService({ db });
  const chat = createChatService({
    db,
    clientService,
    artifactService,
    competitors: ['Rapid Flow', 'CityPipe'],
  });
  return { db, chat, artifactService, clientId: sample?.id };
}

const kinds = (events) => events.map((e) => e.event);
const textOf = (events) =>
  events
    .filter((e) => e.event === 'text')
    .map((e) => e.data.delta)
    .join('');

describe('xo chat service: a turn', () => {
  it('opens a chat and streams start, text and done, with the visibility numbers', async () => {
    const { chat } = await setup();
    const events = chat.startTurn(owner, { text: 'Why is my client missing?' });
    assert.equal(events[0].event, 'start');
    assert.equal(events.at(-1).event, 'done');
    assert.match(textOf(events), /named in 2 of 10 answers/);
    assert.deepEqual(
      chat.listConversations(owner).conversations.map((c) => c.title),
      ['Why is my client missing?'],
    );
  });

  it('shows each step as it starts and then as it ends', async () => {
    const { chat } = await setup();
    const tools = chat
      .startTurn(owner, { text: 'Why is my client missing?' })
      .filter((e) => e.event === 'tool');
    assert.deepEqual(
      tools.map((e) => e.data.phase),
      ['start', 'end'],
    );
    assert.equal(tools[1].data.ok, true);
  });

  it('makes a draft and a card when asked for structured data', async () => {
    const { chat, artifactService } = await setup();
    const events = chat.startTurn(owner, { text: 'Write JSON-LD for the home page' });
    const card = events.find((e) => e.event === 'card').data.card;
    assert.equal(card.kind, 'artifact');
    assert.equal(card.artifact.kind, 'jsonld');
    assert.equal(card.state, 'pending');
    assert.equal(artifactService.listApprovals(owner).pendingCount, 1);
    assert.ok(kinds(events).includes('refresh'));
  });

  it('offers a scan card and follows an Answers link when it points the person somewhere', async () => {
    const { chat } = await setup();
    const scan = chat.startTurn(owner, { text: 'run a scan' });
    assert.equal(scan.find((e) => e.event === 'card').data.card.kind, 'scan');
    const visibility = chat.startTurn(owner, { text: 'why is it missing?' });
    assert.match(visibility.find((e) => e.event === 'ui').data.hash, /^#\/clients\/\d+\/answers$/);
  });

  it('answers a workspace with no client without making a card', async () => {
    const { chat } = await setup({ withClient: false });
    const events = chat.startTurn(owner, { text: 'what should I fix first?' });
    assert.match(textOf(events), /no client/);
    assert.equal(kinds(events).includes('card'), false);
  });

  it('adds to an existing chat and keeps one history entry', async () => {
    const { chat } = await setup();
    const first = chat.startTurn(owner, { text: 'hello' });
    const id = first[0].data.conversationId;
    chat.startTurn(owner, { text: 'what is waiting for approval?', conversationId: id });
    const { messages } = chat.getConversation(owner, id);
    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
    assert.equal(chat.listConversations(owner).conversations.length, 1);
  });
});

describe('xo chat service: access and limits', () => {
  it('keeps a chat private to the person who started it', async () => {
    const { chat } = await setup();
    const id = chat.startTurn(owner, { text: 'hello' })[0].data.conversationId;
    assert.throws(() => chat.getConversation(other, id), { status: 404 });
    assert.throws(() => chat.startTurn(other, { text: 'hello', conversationId: id }), {
      status: 404,
    });
    assert.deepEqual(chat.listConversations(other).conversations, []);
  });

  it('closes a chat that reaches the message limit', async () => {
    const { chat } = await setup();
    const id = chat.startTurn(owner, { text: 'hello' })[0].data.conversationId;
    for (let n = 2; n <= MAX_MESSAGES / 2; n++)
      chat.startTurn(owner, { text: 'hello again', conversationId: id });
    assert.throws(() => chat.startTurn(owner, { text: 'one more', conversationId: id }), {
      status: 409,
      code: 'conversation_closed',
    });
    assert.equal(chat.getConversation(owner, id).conversation.status, 'closed');
  });
});

describe('xo chat service: reading a chat back', () => {
  it('returns messages and cards in the shape the panel redraws from', async () => {
    const { chat } = await setup();
    const id = chat.startTurn(owner, { text: 'draft an llms.txt please' })[0].data.conversationId;
    const { conversation, messages, cards } = chat.getConversation(owner, id);
    assert.equal(conversation.title, 'draft an llms.txt please');
    assert.equal(messages[0].answered, true);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].card.cardId, 'card-1');
    assert.equal(typeof cards[0].createdAt, 'number');
  });
});

describe('xo chat service: suggestions, usage and dismissing', () => {
  it('suggests questions about the client and a link to waiting drafts', async () => {
    const { chat, clientId } = await setup();
    const plain = chat.suggestions(owner, { clientId: String(clientId) }).suggestions;
    assert.match(plain[0].message, /Why is Northside Plumbing missing/);
    chat.startTurn(owner, { text: 'draft an llms.txt' });
    const waiting = chat.suggestions(owner).suggestions;
    assert.deepEqual(waiting[0], { label: 'Review 1 draft', hash: '#/approvals' });
  });

  it('points an empty workspace at adding a client', async () => {
    const { chat } = await setup({ withClient: false });
    assert.deepEqual(chat.suggestions(owner).suggestions, [
      { label: 'Add your first client', hash: '#/clients' },
    ]);
  });

  it('reports no limit', async () => {
    const { chat } = await setup();
    assert.deepEqual(chat.usage(), { blocked: null, rateLimit: null });
  });

  it('dismisses an open scan card once', async () => {
    const { chat } = await setup();
    const events = chat.startTurn(owner, { text: 'run a scan' });
    const { cardId } = events.find((e) => e.event === 'card').data.card;
    const { card } = chat.dismissCard(owner, cardId);
    assert.equal(card.state, 'dismissed');
    assert.deepEqual(card.actions, []);
    assert.throws(() => chat.dismissCard(owner, cardId), { status: 409 });
    assert.throws(() => chat.dismissCard(owner, 'card-999'), { status: 404 });
    assert.throws(() => chat.dismissCard(owner, 'art-1'), { status: 404 });
  });
});
