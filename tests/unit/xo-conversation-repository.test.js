import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as chats from '../../src/server/repositories/xo-conversation-repository.js';

function setup() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO workspaces (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO users (id, email, name, password_hash) VALUES (1, 'a@one.test', 'A', 'x'), (2, 'b@one.test', 'B', 'x');
  `);
  return db;
}

describe('xo conversation repository', () => {
  it('stores a chat and its messages in order', () => {
    const db = setup();
    const id = chats.insertConversation(db, {
      workspaceId: 1,
      userId: 1,
      title: 'Why am I missing?',
    });
    chats.insertMessage(db, { workspaceId: 1, conversationId: id, role: 'user', text: 'Hello' });
    chats.insertMessage(db, { workspaceId: 1, conversationId: id, role: 'assistant', text: 'Hi' });
    assert.deepEqual(
      chats.listMessages(db, 1, id).map(({ role, text }) => ({ role, text })),
      [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Hi' },
      ],
    );
    assert.equal(chats.countMessages(db, 1, id), 2);
    assert.equal(typeof chats.listMessages(db, 1, id)[0].createdAt, 'number');
  });

  it('shows a chat only to its owner in its workspace', () => {
    const db = setup();
    const id = chats.insertConversation(db, { workspaceId: 1, userId: 1, title: 'Mine' });
    assert.equal(chats.findConversation(db, 1, 1, id).title, 'Mine');
    assert.equal(chats.findConversation(db, 1, 2, id), undefined);
    assert.equal(chats.findConversation(db, 2, 1, id), undefined);
    assert.deepEqual(chats.listConversations(db, 1, 2), []);
  });

  it('lists the most recently active chat first', () => {
    const db = setup();
    const first = chats.insertConversation(db, { workspaceId: 1, userId: 1, title: 'First' });
    const second = chats.insertConversation(db, { workspaceId: 1, userId: 1, title: 'Second' });
    db.prepare(
      "UPDATE xo_conversations SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
    ).run(first);
    db.prepare(
      "UPDATE xo_conversations SET updated_at = '2026-01-02T00:00:00.000Z' WHERE id = ?",
    ).run(second);
    assert.deepEqual(
      chats.listConversations(db, 1, 1).map((c) => c.title),
      ['Second', 'First'],
    );
    chats.touchConversation(db, 1, first);
    assert.deepEqual(
      chats.listConversations(db, 1, 1).map((c) => c.title),
      ['First', 'Second'],
    );
  });

  it('closes a chat', () => {
    const db = setup();
    const id = chats.insertConversation(db, { workspaceId: 1, userId: 1, title: 'Long chat' });
    chats.closeConversation(db, 1, id);
    assert.equal(chats.findConversation(db, 1, 1, id).status, 'closed');
  });
});
