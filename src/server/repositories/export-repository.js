/**
 * Bulk reads for the workspace export: each function reads one kind of row for the whole
 * workspace in a single query, so the size of the export never multiplies the number of queries.
 * Columns are listed by name on purpose: a column added to a table later does not leave the
 * database in an export until someone decides it should. Password hashes and session tokens are
 * never selected here.
 */

const rows = (db, sql, ...params) => db.prepare(sql).all(...params);

/** Everyone in the workspace, with their role there. */
export function listMembers(db, workspaceId) {
  return rows(
    db,
    `SELECT u.name, u.email, m.role, m.created_at AS joinedAt
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ? ORDER BY m.created_at, u.id`,
    workspaceId,
  ).map((row) => ({ ...row }));
}

/** Every client, archived ones included. */
export function listClients(db, workspaceId) {
  return rows(
    db,
    `SELECT id, name, domain, type, city, country, sample, archived_at AS archivedAt,
            next_run_at AS nextRunAt, deletion_requested_at AS deletionRequestedAt,
            deletion_execute_after AS deletionExecuteAfter, created_at AS createdAt
     FROM clients WHERE workspace_id = ? ORDER BY id`,
    workspaceId,
  ).map((row) => ({ ...row, sample: row.sample === 1 }));
}

export function listQuestions(db, workspaceId) {
  return rows(
    db,
    `SELECT id, client_id AS clientId, text, intent, active, deleted_at AS deletedAt, position
     FROM questions WHERE workspace_id = ? ORDER BY client_id, position, id`,
    workspaceId,
  ).map((row) => ({ ...row, active: row.active === 1 }));
}

export function listScans(db, workspaceId) {
  return rows(
    db,
    `SELECT id, client_id AS clientId, number, state, total, completed, error,
            created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
     FROM scans WHERE workspace_id = ? ORDER BY client_id, number`,
    workspaceId,
  ).map((row) => ({ ...row }));
}

export function listAnswers(db, workspaceId) {
  return rows(
    db,
    `SELECT id, scan_id AS scanId, question_id AS questionId, question_text AS questionText,
            engine, status, text, error, mentioned, position, label, citations,
            cited_urls AS citedUrls, competitors, created_at AS createdAt
     FROM answers WHERE workspace_id = ? ORDER BY scan_id, id`,
    workspaceId,
  ).map((row) => ({
    ...row,
    mentioned: row.mentioned === 1,
    citations: JSON.parse(row.citations),
    citedUrls: JSON.parse(row.citedUrls),
    competitors: JSON.parse(row.competitors),
  }));
}

export function listFixes(db, workspaceId) {
  return rows(
    db,
    `SELECT id, client_id AS clientId, position, title, type, impact, evidence, url, engines,
            why, code, lang, verify, gain, status, done_at AS doneAt
     FROM fixes WHERE workspace_id = ? ORDER BY client_id, position`,
    workspaceId,
  ).map((row) => ({ ...row, engines: JSON.parse(row.engines) }));
}

/** @returns {{ fixId: number, answerId: number }[]} */
export function listFixEvidence(db, workspaceId) {
  return rows(
    db,
    'SELECT fix_id AS fixId, answer_id AS answerId FROM fix_evidence WHERE workspace_id = ? ORDER BY fix_id, answer_id',
    workspaceId,
  ).map((row) => ({ ...row }));
}

export function listHandoffs(db, workspaceId) {
  return rows(
    db,
    `SELECT fix_id AS fixId, channel, created_at AS createdAt
     FROM fix_handoffs WHERE workspace_id = ? ORDER BY id`,
    workspaceId,
  ).map((row) => ({ ...row }));
}
