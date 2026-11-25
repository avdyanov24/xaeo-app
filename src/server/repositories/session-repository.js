/** SQL for `sessions`. Tokens never reach this layer; only their hashes do. */

export function insertSession(db, { tokenHash, userId, workspaceId, expiresAt }) {
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, workspace_id, expires_at) VALUES (?, ?, ?, ?)',
  ).run(tokenHash, userId, workspaceId, expiresAt);
}

/**
 * Loads a session with its user and workspace. The join on memberships means a
 * session stops working as soon as the user is removed from the workspace.
 */
export function findSession(db, tokenHash) {
  const row = db
    .prepare(
      `SELECT s.expires_at AS expiresAt,
              u.id AS userId, u.email, u.name AS userName, u.role AS userRole,
              w.id AS workspaceId, w.name AS workspaceName, m.role AS memberRole
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return undefined;
  return {
    expiresAt: row.expiresAt,
    user: { id: row.userId, email: row.email, name: row.userName, role: row.userRole },
    workspace: { id: row.workspaceId, name: row.workspaceName, role: row.memberRole },
  };
}

export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

/** @returns {number} how many sessions were removed */
export function deleteExpiredSessions(db, nowIso) {
  return Number(db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso).changes);
}
