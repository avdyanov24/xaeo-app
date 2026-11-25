/** SQL for `workspaces` and `memberships`. */

/** @returns {number} the new workspace's id */
export function insertWorkspace(db, name) {
  return Number(db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(name).lastInsertRowid);
}

export function insertMembership(db, { workspaceId, userId, role }) {
  db.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').run(
    workspaceId,
    userId,
    role,
  );
}

/**
 * The workspace a user lands in after signing in: the one they joined first.
 * @returns {{ workspaceId: number, role: string } | undefined}
 */
export function findDefaultMembership(db, userId) {
  return db
    .prepare(
      `SELECT workspace_id AS workspaceId, role FROM memberships
       WHERE user_id = ? ORDER BY created_at, workspace_id LIMIT 1`,
    )
    .get(userId);
}
