/**
 * SQL for the `clients` table. Every function takes the workspace id and puts it in the WHERE
 * clause, so a client from another workspace is never returned or changed.
 *
 * @typedef {object} ClientRow
 * @property {number} id
 * @property {number} workspaceId
 * @property {string} name
 * @property {string} domain
 * @property {string} type
 * @property {string} city
 * @property {string} country
 * @property {boolean} sample
 * @property {string | null} archivedAt
 * @property {string | null} nextRunAt
 * @property {string} createdAt
 */

const COLUMNS = `id, workspace_id AS workspaceId, name, domain, type, city, country, sample,
  archived_at AS archivedAt, next_run_at AS nextRunAt, created_at AS createdAt`;

/** SQLite stores `sample` as 0 or 1. */
const toClient = (row) => row && { ...row, sample: row.sample === 1 };

/** @returns {number} the new client's id */
export function insertClient(
  db,
  {
    workspaceId,
    name,
    domain,
    type = '',
    city = '',
    country = 'GB',
    sample = false,
    nextRunAt = null,
  },
) {
  const result = db
    .prepare(
      `INSERT INTO clients (workspace_id, name, domain, type, city, country, sample, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, name, domain, type, city, country, sample ? 1 : 0, nextRunAt);
  return Number(result.lastInsertRowid);
}

/** @returns {ClientRow | undefined} */
export function findClient(db, workspaceId, id) {
  return toClient(
    db
      .prepare(`SELECT ${COLUMNS} FROM clients WHERE workspace_id = ? AND id = ?`)
      .get(workspaceId, id),
  );
}

/**
 * Clients of a workspace, newest first. `archived` picks which half of the list to return.
 * @returns {ClientRow[]}
 */
export function listClients(db, workspaceId, { archived = false } = {}) {
  const archivedClause = archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM clients WHERE workspace_id = ? AND ${archivedClause}
       ORDER BY created_at DESC, id DESC`,
    )
    .all(workspaceId)
    .map(toClient);
}

export function countArchivedClients(db, workspaceId) {
  return db
    .prepare('SELECT count(*) AS n FROM clients WHERE workspace_id = ? AND archived_at IS NOT NULL')
    .get(workspaceId).n;
}

// Column names come from this list, never from the caller, so the UPDATE below stays parameterised.
const EDITABLE = {
  name: 'name',
  domain: 'domain',
  type: 'type',
  city: 'city',
  country: 'country',
  nextRunAt: 'next_run_at',
};

/**
 * Changes the given fields of a client.
 * @param {Partial<Pick<ClientRow, 'name' | 'domain' | 'type' | 'city' | 'country' | 'nextRunAt'>>} fields
 * @returns {boolean} false when the client does not exist in this workspace
 */
export function updateClient(db, workspaceId, id, fields) {
  const keys = Object.keys(fields).filter((key) => Object.hasOwn(EDITABLE, key));
  if (!keys.length) return findClient(db, workspaceId, id) !== undefined;
  const assignments = keys.map((key) => `${EDITABLE[key]} = ?`).join(', ');
  const result = db
    .prepare(`UPDATE clients SET ${assignments} WHERE workspace_id = ? AND id = ?`)
    .run(...keys.map((key) => fields[key]), workspaceId, id);
  return result.changes > 0;
}

/**
 * Archives a client (pass an ISO timestamp) or brings it back (pass null).
 * @returns {boolean} false when the client does not exist in this workspace
 */
export function setArchivedAt(db, workspaceId, id, archivedAt) {
  const result = db
    .prepare('UPDATE clients SET archived_at = ? WHERE workspace_id = ? AND id = ?')
    .run(archivedAt, workspaceId, id);
  return result.changes > 0;
}
