import { notFound } from '../lib/errors.js';
import * as answers from '../repositories/answer-repository.js';
import * as clients from '../repositories/client-repository.js';
import * as scans from '../repositories/scan-repository.js';
import { ENGINES } from './engines/engine.js';

/** Scans in these states hold answers worth reading. A queued or running scan is still being filled in. */
const READABLE_STATES = ['done', 'cancelled'];

/** The ids go to the browser as strings: the grid uses them as DOM data attributes and compares them as text. */
const publicId = (id) => String(id);

/**
 * What the Answers tab says about how a scan's answers were collected. Only facts this build records
 * are listed; the web app prints "Not recorded" for the rest, never today's settings in their place.
 */
function describeConfiguration(rows) {
  const questionIds = [...new Set(rows.map((row) => row.questionId))];
  return {
    state: 'recorded',
    source: 'sample',
    snapshot: {
      methodology: 'Scripted sample answers read from a fixed answer set',
      extractionVersion: 'Fixed matching rules',
      questions: questionIds.map(publicId),
      competitors: { mode: 'Business names found in the answer text' },
    },
    limitations: [
      'The answers are scripted sample data, so they show how the app works and do not describe how a live engine answers today.',
    ],
  };
}

/**
 * Says whether a scan can be set beside the one before it. Scans that asked different questions
 * measure different things, so they start a new baseline instead of showing a change.
 */
function compareToPrevious(rows, previousRows) {
  if (!previousRows)
    return {
      comparable: false,
      reasons: [{ message: 'This is the first scan for this client, so it starts a baseline.' }],
    };
  const asked = new Set(rows.map((row) => row.questionId));
  const before = new Set(previousRows.map((row) => row.questionId));
  const same = asked.size === before.size && [...asked].every((id) => before.has(id));
  return same
    ? { comparable: true, reasons: [] }
    : {
        comparable: false,
        reasons: [
          {
            message:
              'The buyer questions changed since the previous scan, so this starts a new baseline.',
          },
        ],
      };
}

/**
 * Reads of a client's collected answers, shaped for the Answers tab. Every method takes the
 * workspace id first and passes it to the repositories.
 * @param {{ db: import('node:sqlite').DatabaseSync }} deps
 */
export function createAnswerService({ db }) {
  const engines = Object.values(ENGINES).map(({ id, name }) => ({ id, name }));

  return {
    /**
     * The grid for one scan of a client: its questions down the side, the engines across, and one
     * cell per answer. Without `scanId` it is the newest finished scan.
     * @param {number} workspaceId
     * @param {number} clientId
     * @param {number | null} [scanId]
     * @throws 404 when the client, or a scan that belongs to it, does not exist in this workspace
     */
    grid(workspaceId, clientId, scanId = null) {
      if (!clients.findClient(db, workspaceId, clientId)) throw notFound('Client not found.');

      const withTotals = (scan) => ({ ...scan, ...answers.scanTotals(db, workspaceId, scan.id) });
      const history = scans
        .listScans(db, workspaceId, clientId)
        .map(withTotals)
        .filter((scan) => READABLE_STATES.includes(scan.state) && scan.ok + scan.failed > 0);

      let scan;
      if (scanId === null) scan = history.find((candidate) => candidate.state === 'done');
      else {
        scan = history.find((candidate) => candidate.id === scanId);
        if (!scan) throw notFound('Scan not found.');
      }
      if (!scan) return { scan: null, scans: [], questions: [], engines, cells: {} };

      const rows = answers.listAnswers(db, workspaceId, scan.id);
      const before = history.find(
        (candidate) => candidate.state === 'done' && candidate.number < scan.number,
      );
      const previousRows = before && answers.listAnswers(db, workspaceId, before.id);

      const questions = [];
      const cells = {};
      for (const row of rows) {
        const key = publicId(row.questionId);
        if (!cells[key]) {
          cells[key] = {};
          questions.push({ id: key, text: row.questionText });
        }
        cells[key][row.engine] = {
          id: publicId(row.id),
          status: row.status,
          label: row.label,
          position: row.position,
          error: row.error,
        };
      }

      return {
        scan: {
          ...scan,
          status: scan.state,
          configuration: describeConfiguration(rows),
          comparisonToPrevious: compareToPrevious(rows, previousRows),
        },
        scans: history,
        questions,
        engines,
        cells,
      };
    },
  };
}
