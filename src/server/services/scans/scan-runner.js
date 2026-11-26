import { badRequest, conflict, notFound } from '../../lib/errors.js';
import * as answers from '../../repositories/answer-repository.js';
import * as clients from '../../repositories/client-repository.js';
import * as questions from '../../repositories/question-repository.js';
import * as scans from '../../repositories/scan-repository.js';
import { collectAnswer } from './collect.js';
import { applyEvent, createScan, recordAnswer } from './scan-state.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs scans inside the server process. A scan is queued, then asks every active question of every
 * engine one answer at a time, storing each answer as it arrives so the web app can show progress
 * while it polls. There is no job queue: a scan that was running when the process stopped is
 * marked failed by `recover()` and can be retried.
 *
 * The database row is the source of truth for the scan's state. The loop re-reads it around every
 * answer, so a cancel that lands while an engine is thinking stops the scan before that answer is stored.
 *
 * @param {object} deps
 * @param {import('node:sqlite').DatabaseSync} deps.db
 * @param {import('../engines/engine.js').Engine[]} deps.engines engines to ask, in column order
 * @param {string[]} [deps.competitors] business names to look for besides the client
 * @param {{ error: Function }} [deps.logger]
 * @param {number} [deps.stepDelayMs] pause before each answer, so progress is visible with sample data
 * @param {() => number} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function createScanRunner({
  db,
  engines,
  competitors = [],
  logger,
  stepDelayMs = 300,
  now = Date.now,
  sleep = defaultSleep,
}) {
  /** The latest run of each scan id, so a retried scan waits for its cancelled run to stop first. */
  const runs = new Map();

  const activeQuestions = (workspaceId, clientId) =>
    questions.listQuestions(db, workspaceId, clientId).filter((question) => question.active);

  const requireScan = (workspaceId, scanId) => {
    const scan = scans.findScan(db, workspaceId, scanId);
    if (!scan) throw notFound('Scan not found.');
    return scan;
  };

  /** Moves a scan to `failed` unless something else already finished it. */
  const failScan = (workspaceId, scanId, message) => {
    const scan = scans.findScan(db, workspaceId, scanId);
    if (!scan || (scan.state !== 'running' && scan.state !== 'queued')) return;
    const running = scan.state === 'queued' ? applyEvent(scan, 'start', { now: now() }) : scan;
    scans.saveScan(
      db,
      workspaceId,
      scanId,
      applyEvent(running, 'fail', { now: now(), error: message }),
    );
  };

  async function execute(workspaceId, scanId) {
    let scan = requireScan(workspaceId, scanId);
    if (scan.state !== 'queued') return;
    const client = clients.findClient(db, workspaceId, scan.clientId);
    const asked = activeQuestions(workspaceId, scan.clientId);
    const slots = asked.flatMap((question) => engines.map((engine) => ({ question, engine })));
    if (!client || slots.length !== scan.total) {
      failScan(
        workspaceId,
        scanId,
        'The questions changed since this scan was queued. Run a new scan.',
      );
      return;
    }

    scan = applyEvent(scan, 'start', { now: now() });
    scans.saveScan(db, workspaceId, scanId, scan);
    const context = { client: { name: client.name, domain: client.domain }, competitors };

    for (const { question, engine } of slots) {
      await sleep(stepDelayMs);
      if (scans.findScan(db, workspaceId, scanId).state !== 'running') return;
      const result = await collectAnswer({ engine, question: question.text, context });
      // A cancel may have landed while the engine was answering; that answer is dropped.
      const current = scans.findScan(db, workspaceId, scanId);
      if (current.state !== 'running') return;
      answers.insertAnswer(db, {
        workspaceId,
        scanId,
        questionId: question.id,
        questionText: question.text,
        ...result,
      });
      scan = recordAnswer(current);
      scans.saveScan(db, workspaceId, scanId, scan);
    }
    scans.saveScan(db, workspaceId, scanId, applyEvent(scan, 'complete', { now: now() }));
  }

  /** Starts `execute` in the background. Its failures are recorded on the scan, never thrown. */
  function launch(workspaceId, scanId) {
    // A cancelled run only notices at its next check. Starting the retry after it has stopped means
    // two loops never store answers for the same scan.
    const previous = runs.get(scanId) ?? Promise.resolve();
    const run = previous
      .then(() => execute(workspaceId, scanId))
      .catch((error) => {
        logger?.error('scan failed', { scanId, error: error.message });
        failScan(workspaceId, scanId, 'The scan stopped because of an internal error.');
      })
      .finally(() => {
        if (runs.get(scanId) === run) runs.delete(scanId);
      });
    runs.set(scanId, run);
  }

  return {
    /**
     * Queues a scan of the client's active questions on every engine and starts it.
     * @returns the stored scan, in state `queued`
     * @throws {import('../../lib/errors.js').HttpError} 404 for an unknown client, 409 when the client is
     *   archived or already has a scan in progress, 400 when no question is switched on
     */
    startScan(workspaceId, clientId) {
      const client = clients.findClient(db, workspaceId, clientId);
      if (!client) throw notFound('Client not found.');
      if (client.archivedAt) throw conflict('Restore this client before running a scan.');
      if (scans.findActiveScan(db, workspaceId, clientId))
        throw conflict('A scan is already running for this client.');
      const count = activeQuestions(workspaceId, clientId).length;
      if (!count) throw badRequest('Turn on at least one question before running a scan.');

      const total = count * engines.length;
      const id = scans.insertScan(db, {
        workspaceId,
        clientId,
        scan: createScan({ total, now: now() }),
      });
      launch(workspaceId, id);
      return scans.findScan(db, workspaceId, id);
    },

    /**
     * Stops a queued or running scan. Answers already stored are kept.
     * @throws 404 for an unknown scan, 409 when it has already finished
     */
    cancelScan(workspaceId, scanId) {
      const scan = requireScan(workspaceId, scanId);
      scans.saveScan(db, workspaceId, scanId, applyEvent(scan, 'cancel', { now: now() }));
      return scans.findScan(db, workspaceId, scanId);
    },

    /**
     * Starts a failed or cancelled scan again from the first answer.
     * @throws 404 for an unknown scan, 409 when the scan cannot be retried or the client has another scan running
     */
    retryScan(workspaceId, scanId) {
      const scan = requireScan(workspaceId, scanId);
      const retried = applyEvent(scan, 'retry', { now: now() });
      if (scans.findActiveScan(db, workspaceId, scan.clientId))
        throw conflict('A scan is already running for this client.');
      answers.deleteAnswers(db, workspaceId, scanId);
      scans.saveScan(db, workspaceId, scanId, retried);
      launch(workspaceId, scanId);
      return scans.findScan(db, workspaceId, scanId);
    },

    /**
     * Fails scans that were queued or running when the previous process stopped, because nothing is
     * left to finish them. Call once at start-up.
     * @returns {number} how many scans were marked failed
     */
    recover() {
      const unfinished = scans.listUnfinishedScans(db);
      for (const { id, workspaceId } of unfinished)
        failScan(workspaceId, id, 'The server restarted before this scan finished. Retry it.');
      return unfinished.length;
    },

    /** Resolves when every scan that is running in this process has stopped. For tests and shutdown. */
    async idle() {
      while (runs.size) await Promise.allSettled([...runs.values()]);
    },
  };
}
