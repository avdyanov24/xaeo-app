/**
 * SQL for `xo_cards`: the cards Xo put in a chat. A scan card offers to start a scan; an artifact
 * card points at a draft and takes its state from the draft.
 *
 * @typedef {object} CardRow
 * @property {number} id
 * @property {number} conversationId
 * @property {number} clientId
 * @property {'scan' | 'artifact'} kind
 * @property {number | null} artifactId
 * @property {string} state
 * @property {number} createdAt
 */

const COLUMNS = `id, conversation_id AS conversationId, client_id AS clientId, kind,
  artifact_id AS artifactId, state, created_at AS createdAt`;

const toCard = (row) => row && { ...row, createdAt: Date.parse(row.createdAt) };

/** @returns {number} the new card's id */
export function insertCard(db, { workspaceId, conversationId, clientId, kind, artifactId = null }) {
  const result = db
    .prepare(
      `INSERT INTO xo_cards (workspace_id, conversation_id, client_id, kind, artifact_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, conversationId, clientId, kind, artifactId);
  return Number(result.lastInsertRowid);
}

/** @returns {CardRow | undefined} */
export function findCard(db, workspaceId, id) {
  return toCard(
    db
      .prepare(`SELECT ${COLUMNS} FROM xo_cards WHERE workspace_id = ? AND id = ?`)
      .get(workspaceId, id),
  );
}

/**
 * A chat's cards in the order they were made.
 * @returns {CardRow[]}
 */
export function listCards(db, workspaceId, conversationId) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM xo_cards WHERE workspace_id = ? AND conversation_id = ? ORDER BY id`,
    )
    .all(workspaceId, conversationId)
    .map(toCard);
}

/** Sets a scan card's state: `open`, `done` or `dismissed`. */
export function setCardState(db, workspaceId, id, state) {
  db.prepare('UPDATE xo_cards SET state = ? WHERE workspace_id = ? AND id = ?').run(
    state,
    workspaceId,
    id,
  );
}

/** Closes a client's open scan cards, because a scan was started another way. */
export function closeScanCards(db, workspaceId, clientId) {
  db.prepare(
    `UPDATE xo_cards SET state = 'done'
     WHERE workspace_id = ? AND client_id = ? AND kind = 'scan' AND state = 'open'`,
  ).run(workspaceId, clientId);
}
