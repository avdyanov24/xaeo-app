/**
 * SQL for the drafts Xo prepares: `xo_artifacts`, their versions and their event history. The row
 * holds the current version; every edit also writes a row to `xo_artifact_versions`.
 *
 * @typedef {object} ArtifactRow
 * @property {number} id
 * @property {number} clientId
 * @property {'fix' | 'jsonld' | 'llms_txt' | 'page' | 'outreach'} kind
 * @property {string} title
 * @property {string} summary
 * @property {string} targetUrl
 * @property {'html' | 'json' | 'markdown' | 'text'} lang
 * @property {'low' | 'medium' | 'high'} risk
 * @property {string} code
 * @property {number} version
 * @property {'draft' | 'pending' | 'approved' | 'applied' | 'rejected'} state
 * @property {string[]} notes
 * @property {string[]} claims what Xo could not match to the client's record
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const ARTIFACT_KINDS = Object.freeze(['fix', 'jsonld', 'llms_txt', 'page', 'outreach']);

const COLUMNS = `id, client_id AS clientId, kind, title, summary, target_url AS targetUrl, lang, risk,
  code, version, state, notes, claims, created_at AS createdAt, updated_at AS updatedAt`;

const toArtifact = (row) =>
  row && {
    ...row,
    notes: JSON.parse(row.notes),
    claims: JSON.parse(row.claims),
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.updatedAt),
  };

/**
 * Stores a new draft at version 1 together with that version's row.
 * @returns {number} the new artifact's id
 */
export function insertArtifact(db, input) {
  const { workspaceId, clientId, kind, title, code, contentHash } = input;
  const { summary = '', targetUrl = '', lang = 'text', risk = 'low' } = input;
  const { state = 'pending', notes = [], claims = [] } = input;
  const result = db
    .prepare(
      `INSERT INTO xo_artifacts
         (workspace_id, client_id, kind, title, summary, target_url, lang, risk, code, state, notes, claims)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      workspaceId,
      clientId,
      kind,
      title,
      summary,
      targetUrl,
      lang,
      risk,
      code,
      state,
      JSON.stringify(notes),
      JSON.stringify(claims),
    );
  const id = Number(result.lastInsertRowid);
  db.prepare(
    'INSERT INTO xo_artifact_versions (artifact_id, version, code, content_hash) VALUES (?, 1, ?, ?)',
  ).run(id, code, contentHash);
  return id;
}

/** @returns {ArtifactRow | undefined} */
export function findArtifact(db, workspaceId, id) {
  return toArtifact(
    db
      .prepare(`SELECT ${COLUMNS} FROM xo_artifacts WHERE workspace_id = ? AND id = ?`)
      .get(workspaceId, id),
  );
}

/**
 * Drafts for one client, or for the whole workspace when `clientId` is left out, newest first.
 * @returns {ArtifactRow[]}
 */
export function listArtifacts(db, workspaceId, { clientId } = {}) {
  const where = clientId === undefined ? '' : 'AND client_id = ?';
  const args = clientId === undefined ? [workspaceId] : [workspaceId, clientId];
  return db
    .prepare(`SELECT ${COLUMNS} FROM xo_artifacts WHERE workspace_id = ? ${where} ORDER BY id DESC`)
    .all(...args)
    .map(toArtifact);
}

/** Moves a draft to a new state. */
export function setArtifactState(db, workspaceId, id, state) {
  db.prepare(
    `UPDATE xo_artifacts SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE workspace_id = ? AND id = ?`,
  ).run(state, workspaceId, id);
}

/**
 * Saves new content as the next version and puts the draft back to `pending`.
 * @returns {number} the new version number
 */
export function addVersion(db, workspaceId, id, { code, contentHash }) {
  const { version } = db
    .prepare('SELECT version FROM xo_artifacts WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, id);
  const next = version + 1;
  db.prepare(
    'INSERT INTO xo_artifact_versions (artifact_id, version, code, content_hash) VALUES (?, ?, ?, ?)',
  ).run(id, next, code, contentHash);
  db.prepare(
    `UPDATE xo_artifacts SET code = ?, version = ?, state = 'pending',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE workspace_id = ? AND id = ?`,
  ).run(code, next, workspaceId, id);
  return next;
}

/** @returns {{ version: number, contentHash: string, createdAt: number }[]} oldest first */
export function listVersions(db, artifactId) {
  return db
    .prepare(
      `SELECT version, content_hash AS contentHash, created_at AS createdAt
       FROM xo_artifact_versions WHERE artifact_id = ? ORDER BY version`,
    )
    .all(artifactId)
    .map((row) => ({ ...row, createdAt: Date.parse(row.createdAt) }));
}

/** Writes one line of the draft's history. */
export function insertEvent(
  db,
  { workspaceId, artifactId, action, version = null, actorType, actorName = '' },
) {
  db.prepare(
    `INSERT INTO xo_artifact_events (workspace_id, artifact_id, action, version, actor_type, actor_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(workspaceId, artifactId, action, version, actorType, actorName);
}

/**
 * The draft's history, oldest first. `at` is epoch milliseconds.
 * @returns {{ action: string, version: number | null, actorType: string, actorName: string, at: number }[]}
 */
export function listEvents(db, workspaceId, artifactId) {
  return db
    .prepare(
      `SELECT action, version, actor_type AS actorType, actor_name AS actorName, created_at AS at
       FROM xo_artifact_events WHERE workspace_id = ? AND artifact_id = ? ORDER BY id`,
    )
    .all(workspaceId, artifactId)
    .map((row) => ({ ...row, at: Date.parse(row.at) }));
}
