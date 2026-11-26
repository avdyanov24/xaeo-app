/**
 * SQL for `xo_approvals`. An approval request names one version of a draft and the hash of its
 * content, so a person approves exactly what they reviewed; editing the draft makes the open
 * request stale.
 *
 * @typedef {object} ApprovalRow
 * @property {number} id
 * @property {number} artifactId
 * @property {number} version
 * @property {string} contentHash
 * @property {'pending' | 'approved' | 'rejected' | 'stale'} status
 * @property {number | null} decidedBy
 * @property {number | null} decidedAt
 * @property {number} createdAt
 */

const COLUMNS = `id, artifact_id AS artifactId, version, content_hash AS contentHash, status,
  decided_by AS decidedBy, decided_at AS decidedAt, created_at AS createdAt`;

const toApproval = (row) =>
  row && {
    ...row,
    decidedAt: row.decidedAt ? Date.parse(row.decidedAt) : null,
    createdAt: Date.parse(row.createdAt),
  };

/** @returns {number} the new request's id */
export function insertApproval(db, { workspaceId, artifactId, version, contentHash }) {
  const result = db
    .prepare(
      'INSERT INTO xo_approvals (workspace_id, artifact_id, version, content_hash) VALUES (?, ?, ?, ?)',
    )
    .run(workspaceId, artifactId, version, contentHash);
  return Number(result.lastInsertRowid);
}

/** @returns {ApprovalRow | undefined} */
export function findApproval(db, workspaceId, id) {
  return toApproval(
    db
      .prepare(`SELECT ${COLUMNS} FROM xo_approvals WHERE workspace_id = ? AND id = ?`)
      .get(workspaceId, id),
  );
}

/**
 * The newest request for a draft's current version, whatever its status.
 * @returns {ApprovalRow | undefined}
 */
export function findApprovalForVersion(db, workspaceId, artifactId, version) {
  return toApproval(
    db
      .prepare(
        `SELECT ${COLUMNS} FROM xo_approvals
         WHERE workspace_id = ? AND artifact_id = ? AND version = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(workspaceId, artifactId, version),
  );
}

/**
 * Requests in the workspace, newest first, optionally narrowed to one status or one client.
 * @returns {ApprovalRow[]}
 */
export function listApprovals(db, workspaceId, { status, clientId } = {}) {
  const where = ['a.workspace_id = ?'];
  const args = [workspaceId];
  if (status) {
    where.push('a.status = ?');
    args.push(status);
  }
  if (clientId !== undefined) {
    where.push('d.client_id = ?');
    args.push(clientId);
  }
  return db
    .prepare(
      `SELECT a.id, a.artifact_id AS artifactId, a.version, a.content_hash AS contentHash, a.status,
         a.decided_by AS decidedBy, a.decided_at AS decidedAt, a.created_at AS createdAt
       FROM xo_approvals a JOIN xo_artifacts d ON d.id = a.artifact_id
       WHERE ${where.join(' AND ')} ORDER BY a.id DESC`,
    )
    .all(...args)
    .map(toApproval);
}

/** Records a decision on an open request. */
export function decideApproval(db, workspaceId, id, { status, userId }) {
  db.prepare(
    `UPDATE xo_approvals SET status = ?, decided_by = ?,
       decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE workspace_id = ? AND id = ?`,
  ).run(status, userId, workspaceId, id);
}

/** Marks a draft's open requests stale, because it was edited. */
export function markStale(db, workspaceId, artifactId) {
  db.prepare(
    `UPDATE xo_approvals SET status = 'stale'
     WHERE workspace_id = ? AND artifact_id = ? AND status = 'pending'`,
  ).run(workspaceId, artifactId);
}
