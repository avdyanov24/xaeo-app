import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFailureLimiter } from '../../src/server/lib/rate-limit.js';

const setup = (options = {}) => {
  const clock = { now: 0 };
  const limiter = createFailureLimiter({
    limit: 3,
    windowMs: 60_000,
    now: () => clock.now,
    ...options,
  });
  return { clock, limiter };
};

describe('failure limiter', () => {
  it('blocks a key after the limit and reports the wait in seconds', () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(limiter.retryAfterSeconds('k'), 0);
      limiter.recordFailure('k');
    }
    clock.now = 15_500;
    assert.equal(limiter.retryAfterSeconds('k'), 45);
    assert.equal(limiter.retryAfterSeconds('other'), 0);
  });

  it('unblocks when the window ends', () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure('k');
    clock.now = 60_000;
    assert.equal(limiter.retryAfterSeconds('k'), 0);
  });

  it('reset clears the count', () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure('k');
    limiter.reset('k');
    assert.equal(limiter.retryAfterSeconds('k'), 0);
  });

  it('keeps at most maxKeys entries', () => {
    const { limiter } = setup({ limit: 1, maxKeys: 2 });
    limiter.recordFailure('a');
    limiter.recordFailure('b');
    limiter.recordFailure('c');
    assert.equal(limiter.retryAfterSeconds('a'), 0, 'oldest key was dropped');
    assert.ok(limiter.retryAfterSeconds('c') > 0);
  });

  it('drops expired entries before live ones when it is full', () => {
    const { clock, limiter } = setup({ limit: 1, maxKeys: 2 });
    limiter.recordFailure('old');
    clock.now = 30_000;
    limiter.recordFailure('live');
    clock.now = 60_000; // 'old' has expired, 'live' has 30 s left
    limiter.recordFailure('new');
    assert.ok(limiter.retryAfterSeconds('live') > 0, 'a live entry is kept while one has expired');
    assert.ok(limiter.retryAfterSeconds('new') > 0);
  });

  it('starts a fresh count once the window has passed', () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure('k');
    clock.now = 60_000;
    limiter.recordFailure('k');
    assert.equal(limiter.retryAfterSeconds('k'), 0, 'one failure in the new window is not a block');
  });
});
