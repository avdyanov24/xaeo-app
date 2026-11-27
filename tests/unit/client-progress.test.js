import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deltaOf, nextActionOf } from '../../src/server/services/client-progress.js';

const LATEST = { id: 1, number: 1, finishedAt: '2026-11-26T10:00:00.000Z', ok: 10, mentioned: 2 };

function client(overrides = {}) {
  return {
    status: 'active',
    questions: 5,
    fixes: { todo: 0 },
    latest: LATEST,
    ...overrides,
  };
}

describe('deltaOf', () => {
  it('is null until there are two finished scans to compare', () => {
    assert.equal(deltaOf([]), null);
    assert.equal(deltaOf([{ ok: 10, mentioned: 2 }]), null);
  });

  it('is the change in answers naming the client since the scan before', () => {
    const history = [
      { ok: 10, mentioned: 2 },
      { ok: 10, mentioned: 5 },
    ];
    assert.equal(deltaOf(history), 3);
    assert.equal(deltaOf([...history].reverse()), -3);
  });

  it('is zero when nothing changed', () => {
    assert.equal(
      deltaOf([
        { ok: 10, mentioned: 4 },
        { ok: 10, mentioned: 4 },
      ]),
      0,
    );
  });
});

describe('nextActionOf', () => {
  it('opens an archived client instead of suggesting work on it', () => {
    assert.deepEqual(nextActionOf(client({ status: 'archived' })), {
      label: 'Open',
      tab: 'overview',
    });
  });

  it('asks for questions before anything else', () => {
    assert.deepEqual(nextActionOf(client({ questions: 0, latest: null })), {
      label: 'Add questions',
      tab: 'questions',
    });
  });

  it('starts the first scan from the list when there are questions but no scan', () => {
    assert.deepEqual(nextActionOf(client({ latest: null })), {
      label: 'Run first scan',
      run: true,
    });
  });

  it('points to the fixes while any are still to do', () => {
    assert.deepEqual(nextActionOf(client({ fixes: { todo: 3 } })), {
      label: 'Review fixes',
      tab: 'fixes',
    });
  });

  it('suggests a new scan once every fix is dealt with', () => {
    assert.deepEqual(nextActionOf(client()), { label: 'Run a scan', run: true });
  });
});
