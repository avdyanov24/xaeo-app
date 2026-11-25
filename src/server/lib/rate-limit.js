/**
 * Counts failures per key in a fixed window, in memory. Good enough for one server
 * process; a multi-instance deployment would need a shared store.
 * @param {{ limit: number, windowMs: number, now?: () => number, maxKeys?: number }} options
 */
export function createFailureLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const entries = new Map();

  function current(key) {
    const entry = entries.get(key);
    if (entry && entry.resetAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  // Drops expired entries so a stream of distinct keys cannot grow memory without bound.
  function prune() {
    const time = now();
    for (const [key, entry] of entries) if (entry.resetAt <= time) entries.delete(key);
    // Still full of live entries: drop the oldest (Map keeps insertion order).
    while (entries.size >= maxKeys) entries.delete(entries.keys().next().value);
  }

  return {
    /** Seconds until `key` may try again, or 0 when it is not blocked. */
    retryAfterSeconds(key) {
      const entry = current(key);
      return entry && entry.count >= limit ? Math.ceil((entry.resetAt - now()) / 1000) : 0;
    },
    recordFailure(key) {
      const entry = current(key);
      if (entry) entry.count += 1;
      else {
        if (entries.size >= maxKeys) prune();
        entries.set(key, { count: 1, resetAt: now() + windowMs });
      }
    },
    reset(key) {
      entries.delete(key);
    },
  };
}
