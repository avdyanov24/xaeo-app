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

/**
 * The workspace's example client, archived or not. A workspace has at most one.
 * @returns {ClientRow | undefined}
 */
export function findSampleClient(db, workspaceId) {
  return toClient(
    db
      .prepare(`SELECT ${COLUMNS} FROM clients WHERE workspace_id = ? AND sample = 1 LIMIT 1`)
      .get(workspaceId),
  );
}

/**
 * When deletion of a client was asked for and when it runs; both null when none is pending.
 * @returns {{ requestedAt: string | null, executeAfter: string | null } | undefined} undefined when the client is not in this workspace
 */
export function findDeletion(db, workspaceId, id) {
  const row = db
    .prepare(
      `SELECT deletion_requested_at AS requestedAt, deletion_execute_after AS executeAfter
       FROM clients WHERE workspace_id = ? AND id = ?`,
    )
    .get(workspaceId, id);
  return row && { ...row };
}

/** Sets or clears (pass nulls) the pending deletion of a client. */
export function setDeletion(db, workspaceId, id, { requestedAt, executeAfter }) {
  db.prepare(
    `UPDATE clients SET deletion_requested_at = ?, deletion_execute_after = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(requestedAt, executeAfter, workspaceId, id);
}

/**
 * Clients whose grace period has ended, in every workspace: this is for the background purge, not for a request.
 * @param {string} nowIso
 * @returns {{ id: number, workspaceId: number }[]}
 */
export function listDueForDeletion(db, nowIso) {
  return db
    .prepare(
      `SELECT id, workspace_id AS workspaceId FROM clients
       WHERE deletion_execute_after IS NOT NULL AND deletion_execute_after <= ? ORDER BY id`,
    )
    .all(nowIso)
    .map((row) => ({ ...row }));
}

/** Deletes a client; its questions, scans, answers, fixes and Xo drafts go with it. */
export function deleteClient(db, workspaceId, id) {
  db.prepare('DELETE FROM clients WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
}
