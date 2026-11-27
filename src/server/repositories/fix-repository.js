/**
 * SQL for `fixes`, the answers that justify them (`fix_evidence`) and the exports they went into
 * (`fix_handoffs`). Every query takes the workspace id, so a fix from another workspace is never
 * found, listed or changed.
 *
 * @typedef {object} FixRow
 * @property {number} id
 * @property {number} clientId
 * @property {number} position rank within the client, starting at 1
 * @property {string} title
 * @property {'jsonld' | 'page' | 'listing' | 'copy' | 'crawler'} type
 * @property {'High' | 'Medium' | 'Low'} impact
 * @property {'Strong' | 'Medium' | 'Weak'} evidence
 * @property {string} url
 * @property {string[]} engines engine ids the fix is aimed at
 * @property {string} why
 * @property {string} code the proposed change
 * @property {'jsonld' | 'html' | 'markdown' | 'text'} lang
 * @property {string} verify
 * @property {number} gain missed answers the fix is expected to win back
 * @property {'todo' | 'done' | 'wont'} status
 * @property {string | null} doneAt
 */

const COLUMNS = `id, client_id AS clientId, position, title, type, impact, evidence, url, engines,
  why, code, lang, verify, gain, status, done_at AS doneAt`;

const toFix = (row) => ({ ...row, engines: JSON.parse(row.engines) });

/**
 * Adds a fix at the end of the client's list, with the answers that justify it.
 * @param {{ workspaceId: number, clientId: number, answerIds?: number[], doneAt?: string | null } & Omit<FixRow, 'id' | 'clientId' | 'position' | 'status' | 'doneAt' | 'gain'> & Partial<Pick<FixRow, 'gain' | 'status'>>} fix
 * @returns {number} the new fix's id
 */
export function insertFix(
  db,
  {
    workspaceId,
    clientId,
    title,
    type,
    impact,
    evidence,
    url,
    engines,
    why,
    code,
    lang,
    verify,
    gain = 1,
    status = 'todo',
    doneAt = null,
    answerIds = [],
  },
) {
  const { next } = db
    .prepare(
      'SELECT coalesce(max(position), 0) + 1 AS next FROM fixes WHERE workspace_id = ? AND client_id = ?',
    )
    .get(workspaceId, clientId);
  const id = Number(
    db
      .prepare(
        `INSERT INTO fixes (workspace_id, client_id, position, title, type, impact, evidence, url,
           engines, why, code, lang, verify, gain, status, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspaceId,
        clientId,
        next,
        title,
        type,
        impact,
        evidence,
        url,
        JSON.stringify(engines),
        why,
        code,
        lang,
        verify,
        gain,
        status,
        doneAt,
      ).lastInsertRowid,
  );
  const link = db.prepare(
    'INSERT INTO fix_evidence (workspace_id, fix_id, answer_id) VALUES (?, ?, ?)',
  );
  for (const answerId of answerIds) link.run(workspaceId, id, answerId);
  return id;
}

/** @returns {FixRow[]} the client's fixes in rank order */
export function listFixes(db, workspaceId, clientId) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM fixes WHERE workspace_id = ? AND client_id = ? ORDER BY position`,
    )
    .all(workspaceId, clientId)
    .map(toFix);
}

/** @returns {FixRow | undefined} */
export function findFix(db, workspaceId, id) {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM fixes WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id);
  return row && toFix(row);
}

/**
 * The answers behind every fix of a client, read in one query so the list costs no query per fix.
 * @returns {Map<number, number[]>} fix id to answer ids
 */
export function listEvidence(db, workspaceId, clientId) {
  const rows = db
    .prepare(
      `SELECT e.fix_id AS fixId, e.answer_id AS answerId
       FROM fix_evidence e JOIN fixes f ON f.id = e.fix_id AND f.workspace_id = e.workspace_id
       WHERE e.workspace_id = ? AND f.client_id = ?
       ORDER BY e.fix_id, e.answer_id`,
    )
    .all(workspaceId, clientId);
  const byFix = new Map();
  for (const { fixId, answerId } of rows) byFix.set(fixId, [...(byFix.get(fixId) ?? []), answerId]);
  return byFix;
}

/**
 * Sets a fix's status. `doneAt` is the time it was marked done, or null for any other status.
 * @returns {boolean} whether a fix in this workspace was changed
 */
export function setStatus(db, workspaceId, id, { status, doneAt }) {
  const result = db
    .prepare(
      `UPDATE fixes SET status = ?, done_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE workspace_id = ? AND id = ?`,
    )
    .run(status, doneAt, workspaceId, id);
  return result.changes > 0;
}

/** @returns {{ todo: number, done: number, wont: number, total: number }} */
export function countFixes(db, workspaceId, clientId) {
  const row = db
    .prepare(
      `SELECT coalesce(sum(status = 'todo'), 0) AS todo, coalesce(sum(status = 'done'), 0) AS done,
              coalesce(sum(status = 'wont'), 0) AS wont, count(*) AS total
       FROM fixes WHERE workspace_id = ? AND client_id = ?`,
    )
    .get(workspaceId, clientId);
  return { todo: row.todo, done: row.done, wont: row.wont, total: row.total };
}

/** Records that these fixes went into an export. */
export function insertHandoffs(db, workspaceId, { channel, entries }) {
  const insert = db.prepare(
    'INSERT INTO fix_handoffs (workspace_id, fix_id, channel, content_hash) VALUES (?, ?, ?, ?)',
  );
  for (const { fixId, contentHash } of entries)
    insert.run(workspaceId, fixId, channel, contentHash);
}

/**
 * Per fix, how often it has been handed off, when last, and what the last file said.
 * @returns {Map<number, { count: number, lastAt: string, contentHash: string }>} by fix id, for one channel
 */
export function summarizeHandoffs(db, workspaceId, clientId, channel) {
  const rows = db
    .prepare(
      `SELECT h.fix_id AS fixId, totals.count, h.created_at AS lastAt, h.content_hash AS contentHash
       FROM fix_handoffs h
       JOIN (SELECT fix_id, count(*) AS count, max(id) AS lastId FROM fix_handoffs
             WHERE workspace_id = ? AND channel = ? GROUP BY fix_id) totals ON totals.lastId = h.id
       JOIN fixes f ON f.id = h.fix_id AND f.workspace_id = h.workspace_id
       WHERE h.workspace_id = ? AND f.client_id = ?`,
    )
    .all(workspaceId, channel, workspaceId, clientId);
  return new Map(rows.map(({ fixId, ...rest }) => [fixId, { ...rest }]));
}
