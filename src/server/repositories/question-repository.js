/**
 * SQL for the `questions` table. Deleting a question only sets `deleted_at`: past answers still
 * point at the row and show the wording they were asked with.
 *
 * @typedef {object} QuestionRow
 * @property {number} id
 * @property {number} clientId
 * @property {string} text
 * @property {'find' | 'compare' | 'urgent' | 'trust'} intent
 * @property {boolean} active
 * @property {number} position
 */

/** What a buyer is trying to do when they ask. The migration's CHECK constraint lists the same four. */
export const INTENTS = Object.freeze(['find', 'compare', 'urgent', 'trust']);

const COLUMNS = 'id, client_id AS clientId, text, intent, active, position';

const toQuestion = (row) => row && { ...row, active: row.active === 1 };

/**
 * Adds a question at the end of the client's list.
 * @returns {number} the new question's id
 */
export function insertQuestion(
  db,
  { workspaceId, clientId, text, intent = 'find', active = true },
) {
  const { next } = db
    .prepare(
      'SELECT coalesce(max(position), 0) + 1 AS next FROM questions WHERE workspace_id = ? AND client_id = ?',
    )
    .get(workspaceId, clientId);
  const result = db
    .prepare(
      `INSERT INTO questions (workspace_id, client_id, text, intent, active, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, clientId, text, intent, active ? 1 : 0, next);
  return Number(result.lastInsertRowid);
}

/** @returns {QuestionRow | undefined} a question that has not been deleted */
export function findQuestion(db, workspaceId, id) {
  return toQuestion(
    db
      .prepare(
        `SELECT ${COLUMNS} FROM questions WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
      )
      .get(workspaceId, id),
  );
}

/** @returns {QuestionRow[]} the client's questions that have not been deleted, in list order */
export function listQuestions(db, workspaceId, clientId) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM questions
       WHERE workspace_id = ? AND client_id = ? AND deleted_at IS NULL
       ORDER BY position, id`,
    )
    .all(workspaceId, clientId)
    .map(toQuestion);
}

/**
 * Wording for any question of the client, deleted ones included, for answers that were asked
 * before a question was removed.
 * @returns {Map<number, string>} question id to text
 */
export function questionTexts(db, workspaceId, clientId) {
  const rows = db
    .prepare('SELECT id, text FROM questions WHERE workspace_id = ? AND client_id = ?')
    .all(workspaceId, clientId);
  return new Map(rows.map((row) => [row.id, row.text]));
}

const EDITABLE = { text: 'text', intent: 'intent', active: 'active' };

/**
 * Changes the given fields of a question.
 * @param {Partial<Pick<QuestionRow, 'text' | 'intent' | 'active'>>} fields
 * @returns {boolean} false when the question does not exist in this workspace
 */
export function updateQuestion(db, workspaceId, id, fields) {
  const keys = Object.keys(fields).filter((key) => Object.hasOwn(EDITABLE, key));
  if (!keys.length) return findQuestion(db, workspaceId, id) !== undefined;
  const assignments = keys.map((key) => `${EDITABLE[key]} = ?`).join(', ');
  const values = keys.map((key) => (key === 'active' ? (fields.active ? 1 : 0) : fields[key]));
  const result = db
    .prepare(
      `UPDATE questions SET ${assignments} WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
    )
    .run(...values, workspaceId, id);
  return result.changes > 0;
}

/** @returns {boolean} false when the question does not exist in this workspace */
export function deleteQuestion(db, workspaceId, id, deletedAt = new Date().toISOString()) {
  const result = db
    .prepare(
      'UPDATE questions SET deleted_at = ? WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL',
    )
    .run(deletedAt, workspaceId, id);
  return result.changes > 0;
}

/**
 * Whether any active client of the workspace has a question switched on, for the first-run
 * checklist. One query however many clients there are.
 * @returns {boolean}
 */
export function hasActiveQuestions(db, workspaceId) {
  const row = db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM questions q
         JOIN clients c ON c.id = q.client_id AND c.workspace_id = q.workspace_id
         WHERE q.workspace_id = ? AND q.deleted_at IS NULL AND q.active = 1
           AND c.archived_at IS NULL
       ) AS found`,
    )
    .get(workspaceId);
  return row.found === 1;
}
