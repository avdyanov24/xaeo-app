/**
 * SQL for the `answers` table: one engine's answer to one question in one scan. The JSON columns
 * (citations, cited URLs, competitor names) are written and read here so callers only see arrays.
 *
 * @typedef {object} AnswerRow
 * @property {number} id
 * @property {number} scanId
 * @property {number} questionId
 * @property {string} questionText
 * @property {'chatgpt' | 'claude'} engine
 * @property {'ok' | 'failed'} status
 * @property {string | null} text
 * @property {string | null} error
 * @property {boolean} mentioned
 * @property {number | null} position
 * @property {string | null} label
 * @property {{ url: string, title: string, domain: string }[]} citations
 * @property {string[]} citedUrls
 * @property {string[]} competitors
 */

const COLUMNS = `id, scan_id AS scanId, question_id AS questionId, question_text AS questionText,
  engine, status, text, error, mentioned, position, label, citations,
  cited_urls AS citedUrls, competitors`;

const toAnswer = (row) => ({
  ...row,
  mentioned: row.mentioned === 1,
  citations: JSON.parse(row.citations),
  citedUrls: JSON.parse(row.citedUrls),
  competitors: JSON.parse(row.competitors),
});

/**
 * Stores one answer. Asking the same question of the same engine twice in a scan is an error,
 * so a retry has to clear the scan's answers first.
 * @param {{ workspaceId: number, scanId: number, questionId: number, questionText: string, engine: string, status: 'ok' | 'failed' } & Partial<AnswerRow>} answer
 * @returns {number} the new answer's id
 */
export function insertAnswer(
  db,
  {
    workspaceId,
    scanId,
    questionId,
    questionText,
    engine,
    status,
    text = null,
    error = null,
    mentioned = false,
    position = null,
    label = null,
    citations = [],
    citedUrls = [],
    competitors = [],
  },
) {
  const result = db
    .prepare(
      `INSERT INTO answers (workspace_id, scan_id, question_id, question_text, engine, status, text,
         error, mentioned, position, label, citations, cited_urls, competitors)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      workspaceId,
      scanId,
      questionId,
      questionText,
      engine,
      status,
      text,
      error,
      mentioned ? 1 : 0,
      position,
      label,
      JSON.stringify(citations),
      JSON.stringify(citedUrls),
      JSON.stringify(competitors),
    );
  return Number(result.lastInsertRowid);
}

/** @returns {AnswerRow | undefined} */
export function findAnswer(db, workspaceId, id) {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM answers WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id);
  return row && toAnswer(row);
}

/** @returns {AnswerRow[]} the answers of a scan, in the order they were collected */
export function listAnswers(db, workspaceId, scanId) {
  return db
    .prepare(`SELECT ${COLUMNS} FROM answers WHERE workspace_id = ? AND scan_id = ? ORDER BY id`)
    .all(workspaceId, scanId)
    .map(toAnswer);
}

/**
 * Totals for one scan: answers that came back, how many of those name the client, and failures.
 * @returns {{ ok: number, mentioned: number, failed: number }}
 */
export function scanTotals(db, workspaceId, scanId) {
  const row = db
    .prepare(
      `SELECT coalesce(sum(status = 'ok'), 0) AS ok,
              coalesce(sum(status = 'ok' AND mentioned = 1), 0) AS mentioned,
              coalesce(sum(status = 'failed'), 0) AS failed
       FROM answers WHERE workspace_id = ? AND scan_id = ?`,
    )
    .get(workspaceId, scanId);
  return { ok: row.ok, mentioned: row.mentioned, failed: row.failed };
}

/** Removes a scan's answers, used when the scan is retried from the start. */
export function deleteAnswers(db, workspaceId, scanId) {
  db.prepare('DELETE FROM answers WHERE workspace_id = ? AND scan_id = ?').run(workspaceId, scanId);
}
