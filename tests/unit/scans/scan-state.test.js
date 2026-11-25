import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../../../src/server/lib/errors.js';
import {
  applyEvent,
  canApply,
  createScan,
  isFinished,
  SCAN_EVENTS,
  SCAN_STATES,
} from '../../../src/server/services/scans/scan-state.js';

const T0 = Date.parse('2026-11-25T10:00:00Z');
const T1 = Date.parse('2026-11-25T10:00:03Z');

/** A scan in each state, built only through the public transitions. */
const scanIn = {
  queued: () => createScan({ now: T0 }),
  running: () => applyEvent(scanIn.queued(), 'start', { now: T0 }),
  done: () => applyEvent(scanIn.running(), 'complete', { now: T1 }),
  failed: () => applyEvent(scanIn.running(), 'fail', { now: T1, error: 'Provider timed out.' }),
  cancelled: () => applyEvent(scanIn.running(), 'cancel', { now: T1 }),
};

// Every state against every event: the allowed ones lead to the listed state, all others are rejected.
const ALLOWED = {
  queued: { start: 'running', cancel: 'cancelled' },
  running: { complete: 'done', fail: 'failed', cancel: 'cancelled' },
  done: {},
  failed: { retry: 'queued' },
  cancelled: { retry: 'queued' },
};

describe('scan state machine', () => {
  it('starts queued with only a creation time', () => {
    const scan = createScan({ now: T0 });
    assert.deepEqual(scan, {
      state: 'queued',
      createdAt: '2026-11-25T10:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      error: null,
    });
    assert.ok(Object.isFrozen(scan));
  });

  it('knows the five states and five events', () => {
    assert.deepEqual(SCAN_STATES, ['queued', 'running', 'done', 'failed', 'cancelled']);
    assert.deepEqual([...SCAN_EVENTS].sort(), ['cancel', 'complete', 'fail', 'retry', 'start']);
  });

  for (const state of SCAN_STATES) {
    for (const event of SCAN_EVENTS) {
      const target = ALLOWED[state][event];
      if (target) {
        it(`${state} --${event}--> ${target}`, () => {
          const scan = scanIn[state]();
          assert.equal(canApply(scan, event), true);
          assert.equal(applyEvent(scan, event, { now: T1 }).state, target);
        });
      } else {
        it(`${state} rejects ${event} with 409`, () => {
          const scan = scanIn[state]();
          assert.equal(canApply(scan, event), false);
          assert.throws(
            () => applyEvent(scan, event),
            (error) => error instanceof HttpError && error.status === 409,
          );
        });
      }
    }
  }

  it('stamps startedAt on start and finishedAt on every end state', () => {
    assert.equal(scanIn.running().startedAt, '2026-11-25T10:00:00.000Z');
    assert.equal(scanIn.running().finishedAt, null);
    for (const state of ['done', 'failed', 'cancelled']) {
      assert.equal(scanIn[state]().finishedAt, '2026-11-25T10:00:03.000Z', state);
    }
  });

  it('keeps the failure reason, with a default when none is given', () => {
    assert.equal(scanIn.failed().error, 'Provider timed out.');
    assert.equal(applyEvent(scanIn.running(), 'fail').error, 'The scan failed.');
    assert.equal(scanIn.done().error, null);
  });

  it('clears the timestamps and the error on retry', () => {
    const retried = applyEvent(scanIn.failed(), 'retry', { now: T1 });
    assert.equal(retried.state, 'queued');
    assert.equal(retried.startedAt, null);
    assert.equal(retried.finishedAt, null);
    assert.equal(retried.error, null);
    assert.equal(retried.createdAt, '2026-11-25T10:00:00.000Z');
  });

  it('never changes the scan it is given', () => {
    const scan = scanIn.running();
    const before = { ...scan };
    applyEvent(scan, 'complete');
    assert.deepEqual(scan, before);
  });

  it('says which states are finished', () => {
    assert.deepEqual(
      SCAN_STATES.filter((state) => isFinished(scanIn[state]())),
      ['done', 'failed', 'cancelled'],
    );
  });

  it('describes the rejected move in the error message', () => {
    assert.throws(() => applyEvent(scanIn.done(), 'cancel'), /A done scan cannot be cancelled\./);
  });

  it('throws a TypeError for an event that does not exist', () => {
    assert.throws(() => applyEvent(scanIn.queued(), 'pause'), TypeError);
  });
});
