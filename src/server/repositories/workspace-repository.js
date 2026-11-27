/** SQL for `workspaces` and `memberships`. */

/** @returns {number} the new workspace's id */
export function insertWorkspace(db, name) {
  return Number(db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(name).lastInsertRowid);
}

/** Adds a user to a workspace with a role (owner or member); a pair can be added only once. */
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

/** @returns {{ id: number, name: string } | undefined} the oldest workspace with this exact name */
export function findWorkspaceByName(db, name) {
  const row = db
    .prepare('SELECT id, name FROM workspaces WHERE name = ? ORDER BY id LIMIT 1')
    .get(name);
  return row && { ...row };
}

/**
 * A workspace's name, brand and time zone. The logo file is not part of it: `hasLogo` says whether
 * one is stored and `logoUpdatedAt` versions its URL; `findLogo` reads the bytes.
 * @typedef {object} WorkspaceSettings
 * @property {number} id
 * @property {string} name
 * @property {string} color brand colour as #RRGGBB
 * @property {string} website
 * @property {string} contact
 * @property {string} timezone an IANA zone, or UTC
 * @property {boolean} hasLogo
 * @property {string | null} logoUpdatedAt
 */

/** @returns {WorkspaceSettings | undefined} */
export function findWorkspaceSettings(db, id) {
  const row = db
    .prepare(
      `SELECT id, name, color, website, contact, timezone, logo IS NOT NULL AS hasLogo,
              logo_updated_at AS logoUpdatedAt
       FROM workspaces WHERE id = ?`,
    )
    .get(id);
  return row && { ...row, hasLogo: row.hasLogo === 1 };
}

/** Changes the agency name and the brand shown on reports. */
export function updateBrand(db, id, { name, color, website, contact }) {
  db.prepare(
    'UPDATE workspaces SET name = ?, color = ?, website = ?, contact = ? WHERE id = ?',
  ).run(name, color, website, contact, id);
}

export function setTimezone(db, id, timezone) {
  db.prepare('UPDATE workspaces SET timezone = ? WHERE id = ?').run(timezone, id);
}

/** Stores the logo file, replacing any earlier one. `data` is a Buffer. */
export function setLogo(db, id, { data, type, updatedAt }) {
  db.prepare('UPDATE workspaces SET logo = ?, logo_type = ?, logo_updated_at = ? WHERE id = ?').run(
    data,
    type,
    updatedAt,
    id,
  );
}

export function clearLogo(db, id) {
  db.prepare(
    'UPDATE workspaces SET logo = NULL, logo_type = NULL, logo_updated_at = NULL WHERE id = ?',
  ).run(id);
}

/** @returns {{ data: Buffer, type: string, updatedAt: string } | undefined} undefined when there is no logo */
export function findLogo(db, id) {
  const row = db
    .prepare(
      'SELECT logo, logo_type AS type, logo_updated_at AS updatedAt FROM workspaces WHERE id = ? AND logo IS NOT NULL',
    )
    .get(id);
  return row && { data: Buffer.from(row.logo), type: row.type, updatedAt: row.updatedAt };
}
