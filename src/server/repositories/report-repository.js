/**
 * SQL for `reports`, the saved fix and progress reports. Every query takes the workspace id, so a
 * report from another workspace is never found or listed.
 *
 * @typedef {object} ReportRow
 * @property {number} id
 * @property {number} clientId
 * @property {number} scanId the scan the report was built from
 * @property {'fix' | 'progress'} type
 * @property {boolean} includeAnswers whether the full answers are shown
 * @property {boolean} includeEstimates whether the estimated gains are shown
 * @property {number | null} createdBy the user who confirmed the review
 * @property {string} createdAt
 */

const COLUMNS = `id, client_id AS clientId, scan_id AS scanId, type, include_answers AS includeAnswers,
  include_estimates AS includeEstimates, created_by AS createdBy, created_at AS createdAt`;

const toReport = (row) => ({
  ...row,
  includeAnswers: row.includeAnswers === 1,
  includeEstimates: row.includeEstimates === 1,
});

/**
 * Saves a report for a client's scan.
 * @param {{ workspaceId: number, clientId: number, scanId: number, type: 'fix' | 'progress', includeAnswers?: boolean, includeEstimates?: boolean, createdBy?: number | null }} report
 * @returns {number} the new report's id
 */
export function insertReport(
  db,
  {
    workspaceId,
    clientId,
    scanId,
    type,
    includeAnswers = false,
    includeEstimates = false,
    createdBy = null,
  },
) {
  return Number(
    db
      .prepare(
        `INSERT INTO reports (workspace_id, client_id, scan_id, type, include_answers, include_estimates, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspaceId,
        clientId,
        scanId,
        type,
        includeAnswers ? 1 : 0,
        includeEstimates ? 1 : 0,
        createdBy,
      ).lastInsertRowid,
  );
}

/** @returns {ReportRow | undefined} */
export function findReport(db, workspaceId, id) {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM reports WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id);
  return row && toReport(row);
}

/** @returns {ReportRow[]} the client's saved reports, newest first */
export function listReports(db, workspaceId, clientId) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM reports WHERE workspace_id = ? AND client_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .all(workspaceId, clientId)
    .map(toReport);
}
