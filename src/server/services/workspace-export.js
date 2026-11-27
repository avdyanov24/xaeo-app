import * as exports_ from '../repositories/export-repository.js';
import * as workspaces from '../repositories/workspace-repository.js';

/** Rows grouped under the id they belong to, in the order they were read. */
function groupBy(list, key) {
  const groups = new Map();
  for (const item of list) groups.set(item[key], [...(groups.get(item[key]) ?? []), item]);
  return groups;
}

/** A row without the column that only said where it hangs in the document. */
const without = (row, key) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== key));

/**
 * Everything one workspace holds, as a document it can keep: its brand and time zone, its members,
 * and for each client the questions, scans with their answers, fixes with the answers that justify
 * them, and the exports they went into. The logo file is not in it, only whether one is set.
 * Passwords, session tokens and other workspaces' data are never read.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} workspaceId
 * @param {number} [now] time of the export, in ms
 */
export function exportWorkspace(db, workspaceId, now = Date.now()) {
  const settings = workspaces.findWorkspaceSettings(db, workspaceId);
  const questions = groupBy(exports_.listQuestions(db, workspaceId), 'clientId');
  const scans = groupBy(exports_.listScans(db, workspaceId), 'clientId');
  const answers = groupBy(exports_.listAnswers(db, workspaceId), 'scanId');
  const fixes = groupBy(exports_.listFixes(db, workspaceId), 'clientId');
  const evidence = groupBy(exports_.listFixEvidence(db, workspaceId), 'fixId');
  const handoffs = groupBy(exports_.listHandoffs(db, workspaceId), 'fixId');

  return {
    exportedAt: new Date(now).toISOString(),
    workspace: {
      name: settings.name,
      color: settings.color,
      website: settings.website,
      contact: settings.contact,
      timezone: settings.timezone,
      hasLogo: settings.hasLogo,
    },
    members: exports_.listMembers(db, workspaceId),
    clients: exports_.listClients(db, workspaceId).map((client) => ({
      ...client,
      questions: (questions.get(client.id) ?? []).map((row) => without(row, 'clientId')),
      scans: (scans.get(client.id) ?? []).map((scan) => ({
        ...without(scan, 'clientId'),
        answers: (answers.get(scan.id) ?? []).map((row) => without(row, 'scanId')),
      })),
      fixes: (fixes.get(client.id) ?? []).map((fix) => ({
        ...without(fix, 'clientId'),
        answerIds: (evidence.get(fix.id) ?? []).map((link) => link.answerId),
        handoffs: (handoffs.get(fix.id) ?? []).map((row) => without(row, 'fixId')),
      })),
    })),
  };
}
