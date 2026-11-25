import { conflict } from '../../lib/errors.js';

/**
 * The lifecycle of a scan, as pure functions: every function takes a scan and returns a new one,
 * so the rules can be tested without a database, a clock or a running server.
 *
 *   queued --start--> running --complete--> done
 *      |                 |---fail-------> failed --retry--> queued
 *      |                 '---cancel-----> cancelled --retry--> queued
 *      '---cancel--------------------------^
 *
 * @typedef {'queued' | 'running' | 'done' | 'failed' | 'cancelled'} ScanState
 * @typedef {object} Scan
 * @property {ScanState} state
 * @property {number} total how many answers the scan will collect (questions x engines)
 * @property {number} completed answers collected so far, so the UI can show progress
 * @property {string} createdAt ISO timestamp
 * @property {string | null} startedAt set when the scan starts running
 * @property {string | null} finishedAt set when it reaches done, failed or cancelled
 * @property {string | null} error why it failed, for display
 */

export const SCAN_STATES = Object.freeze(['queued', 'running', 'done', 'failed', 'cancelled']);

/** For each state, the events it accepts and the state each one leads to. */
const TRANSITIONS = Object.freeze({
  queued: { start: 'running', cancel: 'cancelled' },
  running: { complete: 'done', fail: 'failed', cancel: 'cancelled' },
  failed: { retry: 'queued' },
  cancelled: { retry: 'queued' },
  done: {},
});

export const SCAN_EVENTS = Object.freeze([
  ...new Set(Object.values(TRANSITIONS).flatMap((events) => Object.keys(events))),
]);

const iso = (now) => new Date(now).toISOString();

/** A new scan waiting to start. `total` is the number of answers it will collect. */
export function createScan({ total, now = Date.now() }) {
  if (!Number.isInteger(total) || total < 1)
    throw new TypeError('A scan needs a total of at least one answer.');
  return Object.freeze({
    state: 'queued',
    total,
    completed: 0,
    createdAt: iso(now),
    startedAt: null,
    finishedAt: null,
    error: null,
  });
}

/** True when a scan in this state accepts the event. */
export const canApply = (scan, event) => Object.hasOwn(TRANSITIONS[scan.state] ?? {}, event);

/** A scan that will not change unless it is retried. */
export const isFinished = (scan) =>
  scan.state === 'done' || scan.state === 'failed' || scan.state === 'cancelled';

/**
 * Applies one event to a scan and returns the new scan. The input is never changed.
 * @param {Scan} scan
 * @param {'start' | 'complete' | 'fail' | 'cancel' | 'retry'} event
 * @param {{ now?: number | Date | string, error?: string }} [options] `error` is kept for `fail`
 * @throws {TypeError} for an event name that does not exist
 * @throws {import('../../lib/errors.js').HttpError} 409 when the scan's state does not accept the event
 */
export function applyEvent(scan, event, { now = Date.now(), error } = {}) {
  if (!SCAN_EVENTS.includes(event)) throw new TypeError(`Unknown scan event: ${String(event)}`);
  if (!canApply(scan, event)) throw conflict(`A ${scan.state} scan cannot be ${PAST[event]}.`);

  const next = { ...scan, state: TRANSITIONS[scan.state][event] };
  if (event === 'start') next.startedAt = iso(now);
  if (event === 'retry')
    Object.assign(next, { completed: 0, startedAt: null, finishedAt: null, error: null });
  if (isFinished(next)) next.finishedAt = iso(now);
  if (event === 'fail') next.error = error ?? 'The scan failed.';
  return Object.freeze(next);
}

/**
 * Counts one more collected answer. Only a running scan collects answers, and never more than `total`.
 * @param {Scan} scan
 */
export function recordAnswer(scan) {
  if (scan.state !== 'running') throw conflict(`A ${scan.state} scan is not collecting answers.`);
  if (scan.completed >= scan.total)
    throw conflict(`All ${scan.total} answers are already recorded.`);
  return Object.freeze({ ...scan, completed: scan.completed + 1 });
}

/** @returns {{ completed: number, total: number, fraction: number }} fraction is 0 to 1 */
export function progress(scan) {
  return { completed: scan.completed, total: scan.total, fraction: scan.completed / scan.total };
}

// Used in the conflict message: "A done scan cannot be cancelled."
const PAST = Object.freeze({
  start: 'started',
  complete: 'completed',
  fail: 'failed',
  cancel: 'cancelled',
  retry: 'retried',
});
