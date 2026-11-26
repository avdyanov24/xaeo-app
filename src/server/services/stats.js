import { ENGINES } from './engines/engine.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The weekly chart shows this many weeks at most, ending with the current one. */
export const WEEKS_SHOWN = 8;

/** Monday 00:00 UTC of the week that contains the given time. */
export function weekStart(ms) {
  const date = new Date(ms);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday);
}

/** Joins the per-engine rows of each scan back into one record per scan. */
function groupScans(rows) {
  const scans = new Map();
  for (const row of rows) {
    const scan = scans.get(row.scanId) ?? {
      clientId: row.clientId,
      number: row.number,
      finishedMs: Date.parse(row.finishedAt),
      ok: 0,
      mentioned: 0,
      cited: 0,
      engines: {},
    };
    scan.ok += row.ok;
    scan.mentioned += row.mentioned;
    scan.cited += row.cited;
    scan.engines[row.engine] = { ok: row.ok, mentioned: row.mentioned };
    scans.set(row.scanId, scan);
  }
  return [...scans.values()];
}

/** The newest scan of each client that finished before `endMs`, keyed by client. */
function latestPerClient(scans, endMs = Infinity) {
  const latest = new Map();
  for (const scan of scans) {
    const held = latest.get(scan.clientId);
    if (scan.finishedMs < endMs && (!held || scan.number > held.number))
      latest.set(scan.clientId, scan);
  }
  return latest;
}

const sum = (scans, field) => scans.reduce((total, scan) => total + scan[field], 0);

/**
 * The agency-wide numbers on the clients list: each client's latest scan added together, the same
 * for the scan before it, a split by engine and a week-by-week series. These are descriptive
 * totals; weeks can mix different clients and questions, so they are not a controlled comparison.
 *
 * @param {ReturnType<typeof import('../repositories/answer-repository.js').listEngineTotals>} rows
 *   per-engine totals of finished scans, for the clients to count
 * @param {number} now the current time in milliseconds
 */
export function buildStats(rows, now) {
  const scans = groupScans(rows);
  const latest = [...latestPerClient(scans).values()];
  const totals = {
    ok: sum(latest, 'ok'),
    mentioned: sum(latest, 'mentioned'),
    cited: sum(latest, 'cited'),
    // Fixes arrive with the fixes area; until then there is nothing to count.
    doneFixes: 0,
    openFixes: 0,
  };

  // A fair "since last scan" needs every client to have a scan before its latest one.
  const before = latest.map((scan) =>
    scans.find((other) => other.clientId === scan.clientId && other.number === scan.number - 1),
  );
  const previous =
    latest.length && before.every(Boolean)
      ? { ok: sum(before, 'ok'), mentioned: sum(before, 'mentioned') }
      : null;

  const byEngine = Object.values(ENGINES).map(({ id, name }) => ({
    id,
    name,
    ok: latest.reduce((total, scan) => total + (scan.engines[id]?.ok ?? 0), 0),
    mentioned: latest.reduce((total, scan) => total + (scan.engines[id]?.mentioned ?? 0), 0),
  }));

  const weeks = [];
  if (scans.length) {
    const thisWeek = weekStart(now);
    const first = Math.max(
      weekStart(Math.min(...scans.map((scan) => scan.finishedMs))),
      thisWeek - (WEEKS_SHOWN - 1) * WEEK_MS,
    );
    for (let start = first; start <= thisWeek; start += WEEK_MS) {
      const asOfWeek = [...latestPerClient(scans, start + WEEK_MS).values()];
      weeks.push({
        start: new Date(start).toISOString(),
        ok: sum(asOfWeek, 'ok'),
        mentioned: sum(asOfWeek, 'mentioned'),
        fixesDone: 0,
      });
    }
  }

  return { scanned: latest.length > 0, totals, previous, byEngine, weeks };
}
