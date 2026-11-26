/**
 * SQL for the `scans` table. The lifecycle rules live in services/scans/scan-state.js; this file
 * only stores what those pure functions produce and reads it back.
 *
 * @typedef {import('../services/scans/scan-state.js').Scan & { id: number, clientId: number, number: number }} StoredScan
 */

/** node:sqlite rows have no prototype; plain objects compare and serialise like any other. */
const plain = (row) => row && { ...row };

const COLUMNS = `id, client_id AS clientId, number, state, total, completed, error,
  created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt`;

/**
 * Stores a new scan and gives it the next number for its client.
 * @param {{ workspaceId: number, clientId: number, scan: import('../services/scans/scan-state.js').Scan }} input
 * @returns {number} the new scan's id
 */
export function insertScan(db, { workspaceId, clientId, scan }) {
  const { next } = db
    .prepare(
      'SELECT coalesce(max(number), 0) + 1 AS next FROM scans WHERE workspace_id = ? AND client_id = ?',
    )
    .get(workspaceId, clientId);
  const result = db
    .prepare(
      `INSERT INTO scans (workspace_id, client_id, number, state, total, completed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, clientId, next, scan.state, scan.total, scan.completed, scan.createdAt);
  return Number(result.lastInsertRowid);
}

/** @returns {StoredScan | undefined} */
export function findScan(db, workspaceId, id) {
  return plain(
    db
      .prepare(`SELECT ${COLUMNS} FROM scans WHERE workspace_id = ? AND id = ?`)
      .get(workspaceId, id),
  );
}

/** @returns {StoredScan[]} the client's scans, newest first */
export function listScans(db, workspaceId, clientId) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM scans WHERE workspace_id = ? AND client_id = ? ORDER BY number DESC`,
    )
    .all(workspaceId, clientId)
    .map(plain);
}

/**
 * The scan that is waiting or in progress, if any. A client has at most one at a time.
 * @returns {StoredScan | undefined}
 */
export function findActiveScan(db, workspaceId, clientId) {
  return plain(
    db
      .prepare(
        `SELECT ${COLUMNS} FROM scans
         WHERE workspace_id = ? AND client_id = ? AND state IN ('queued', 'running')
         ORDER BY number DESC LIMIT 1`,
      )
      .get(workspaceId, clientId),
  );
}

/**
 * Scans of any workspace that were queued or running, for finding work left over from a
 * process that stopped. Not scoped: only the start-up recovery step calls it.
 * @returns {{ id: number, workspaceId: number }[]}
 */
export function listUnfinishedScans(db) {
  return db
    .prepare(
      "SELECT id, workspace_id AS workspaceId FROM scans WHERE state IN ('queued', 'running') ORDER BY id",
    )
    .all()
    .map(plain);
}

/**
 * Writes the result of a scan-state transition back to the row.
 * @param {import('../services/scans/scan-state.js').Scan} scan
 * @returns {boolean} false when the scan does not exist in this workspace
 */
export function saveScan(db, workspaceId, id, scan) {
  const result = db
    .prepare(
      `UPDATE scans SET state = ?, completed = ?, error = ?, started_at = ?, finished_at = ?
       WHERE workspace_id = ? AND id = ?`,
    )
    .run(scan.state, scan.completed, scan.error, scan.startedAt, scan.finishedAt, workspaceId, id);
  return result.changes > 0;
}
