/**
 * SQL for Xo's chats: `xo_conversations` and `xo_messages`. A chat belongs to one person in one
 * workspace; every read takes both, so nobody reads another person's chat.
 *
 * Times are returned as milliseconds since the epoch, which is what the chat panel sorts by.
 *
 * @typedef {object} ConversationRow
 * @property {number} id
 * @property {string} title
 * @property {'open' | 'closed'} status
 * @property {number} createdAt
 * @property {number} updatedAt
 *
 * @typedef {object} MessageRow
 * @property {number} id
 * @property {'user' | 'assistant'} role
 * @property {string} text
 * @property {number} createdAt
 */

const CONVERSATION = 'id, title, status, created_at AS createdAt, updated_at AS updatedAt';

const toConversation = (row) =>
  row && { ...row, createdAt: Date.parse(row.createdAt), updatedAt: Date.parse(row.updatedAt) };

/** @returns {number} the new chat's id */
export function insertConversation(db, { workspaceId, userId, title }) {
  const result = db
    .prepare('INSERT INTO xo_conversations (workspace_id, user_id, title) VALUES (?, ?, ?)')
    .run(workspaceId, userId, title);
  return Number(result.lastInsertRowid);
}

/** @returns {ConversationRow | undefined} */
export function findConversation(db, workspaceId, userId, id) {
  return toConversation(
    db
      .prepare(
        `SELECT ${CONVERSATION} FROM xo_conversations
         WHERE workspace_id = ? AND user_id = ? AND id = ?`,
      )
      .get(workspaceId, userId, id),
  );
}

/**
 * A person's chats, most recently active first.
 * @returns {ConversationRow[]}
 */
export function listConversations(db, workspaceId, userId, { limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT ${CONVERSATION} FROM xo_conversations
       WHERE workspace_id = ? AND user_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(workspaceId, userId, limit)
    .map(toConversation);
}

/** Marks a chat as active now, so it moves to the top of the history. */
export function touchConversation(db, workspaceId, id) {
  db.prepare(
    `UPDATE xo_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE workspace_id = ? AND id = ?`,
  ).run(workspaceId, id);
}

/** Closes a chat for good; it stays readable in the history. */
export function closeConversation(db, workspaceId, id) {
  db.prepare("UPDATE xo_conversations SET status = 'closed' WHERE workspace_id = ? AND id = ?").run(
    workspaceId,
    id,
  );
}

/** @returns {number} the new message's id */
export function insertMessage(db, { workspaceId, conversationId, role, text }) {
  const result = db
    .prepare(
      'INSERT INTO xo_messages (workspace_id, conversation_id, role, text) VALUES (?, ?, ?, ?)',
    )
    .run(workspaceId, conversationId, role, text);
  return Number(result.lastInsertRowid);
}

/**
 * A chat's messages in the order they were sent.
 * @returns {MessageRow[]}
 */
export function listMessages(db, workspaceId, conversationId) {
  return db
    .prepare(
      `SELECT id, role, text, created_at AS createdAt FROM xo_messages
       WHERE workspace_id = ? AND conversation_id = ? ORDER BY id`,
    )
    .all(workspaceId, conversationId)
    .map((row) => ({ ...row, createdAt: Date.parse(row.createdAt) }));
}

/** @returns {number} how many messages the chat holds */
export function countMessages(db, workspaceId, conversationId) {
  return db
    .prepare('SELECT count(*) AS n FROM xo_messages WHERE workspace_id = ? AND conversation_id = ?')
    .get(workspaceId, conversationId).n;
}
