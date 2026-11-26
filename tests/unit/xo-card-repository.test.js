import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as cards from '../../src/server/repositories/xo-card-repository.js';

function setup() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO workspaces (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO users (id, email, name, password_hash) VALUES (1, 'a@one.test', 'A', 'x');
    INSERT INTO clients (id, workspace_id, name, domain) VALUES (1, 1, 'One', 'one.test'), (2, 1, 'Two', 'two.test');
    INSERT INTO xo_conversations (id, workspace_id, user_id) VALUES (1, 1, 1);
  `);
  return db;
}

const scanCard = (clientId) => ({ workspaceId: 1, conversationId: 1, clientId, kind: 'scan' });

describe('xo card repository', () => {
  it('stores cards open and lists them in the order they were made', () => {
    const db = setup();
    const first = cards.insertCard(db, scanCard(1));
    const second = cards.insertCard(db, scanCard(2));
    assert.deepEqual(
      cards.listCards(db, 1, 1).map((c) => c.id),
      [first, second],
    );
    assert.equal(cards.findCard(db, 1, first).state, 'open');
  });

  it('does not find a card from another workspace', () => {
    const db = setup();
    const id = cards.insertCard(db, scanCard(1));
    assert.equal(cards.findCard(db, 2, id), undefined);
    assert.deepEqual(cards.listCards(db, 2, 1), []);
  });

  it('closes only the open scan cards of the client whose scan started', () => {
    const db = setup();
    const target = cards.insertCard(db, scanCard(1));
    const dismissed = cards.insertCard(db, scanCard(1));
    const other = cards.insertCard(db, scanCard(2));
    cards.setCardState(db, 1, dismissed, 'dismissed');
    cards.closeScanCards(db, 1, 1);
    assert.equal(cards.findCard(db, 1, target).state, 'done');
    assert.equal(cards.findCard(db, 1, dismissed).state, 'dismissed');
    assert.equal(cards.findCard(db, 1, other).state, 'open');
  });
});
