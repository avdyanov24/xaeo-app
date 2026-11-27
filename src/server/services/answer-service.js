import { notFound } from '../lib/errors.js';
import * as answers from '../repositories/answer-repository.js';
import * as clients from '../repositories/client-repository.js';
import * as scans from '../repositories/scan-repository.js';
import { ENGINES } from './engines/engine.js';
import { compareToPrevious, describeConfiguration } from './scan-comparison.js';

/** Scans in these states hold answers worth reading. A queued or running scan is still being filled in. */
const READABLE_STATES = ['done', 'cancelled'];

/** The ids go to the browser as strings: the grid uses them as DOM data attributes and compares them as text. */
const publicId = (id) => String(id);

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

    /**
     * One answer in full, for the reader beside the grid: the text, who was recommended instead
     * and the sources cited.
     * @throws 404 when the answer does not exist in this workspace
     */
    detail(workspaceId, answerId) {
      const answer = answers.findAnswer(db, workspaceId, answerId);
      const scan = answer && scans.findScan(db, workspaceId, answer.scanId);
      const client = scan && clients.findClient(db, workspaceId, scan.clientId);
      if (!client) throw notFound('Answer not found.');
      return {
        id: publicId(answer.id),
        scanId: scan.id,
        engine: ENGINES[answer.engine].name,
        status: answer.status,
        label: answer.label,
        position: answer.position,
        question: answer.questionText,
        clientName: client.name,
        text: answer.text,
        error: answer.error,
        competitors: answer.competitors,
        citations: answer.citations,
        mode: 'sample',
        method: 'Read from the scripted sample answer set. No engine was asked.',
        collectedAt: answer.createdAt,
      };
    },
  };
}
