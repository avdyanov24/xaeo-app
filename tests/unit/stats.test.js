import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStats, weekStart, WEEKS_SHOWN } from '../../src/server/services/stats.js';

// Thursday 26 November 2026; its week starts on Monday 23 November.
const NOW = Date.parse('2026-11-26T12:00:00Z');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let nextScanId = 1;
/** The two per-engine rows of one finished scan: `named` answers name the client in each engine. */
function scanRows(clientId, number, finishedAt, { chatgpt = 0, claude = 0, cited = 0 } = {}) {
  const scanId = nextScanId++;
  const base = { scanId, clientId, number, finishedAt };
  return [
    { ...base, engine: 'chatgpt', ok: 5, mentioned: chatgpt, cited: 0 },
    { ...base, engine: 'claude', ok: 5, mentioned: claude, cited },
  ];
}

describe('weekStart', () => {
  it('returns the Monday 00:00 UTC of the week', () => {
    assert.equal(new Date(weekStart(NOW)).toISOString(), '2026-11-23T00:00:00.000Z');
    assert.equal(
      new Date(weekStart(Date.parse('2026-11-23T00:00:00Z'))).toISOString(),
      '2026-11-23T00:00:00.000Z',
    );
  });

  it('keeps a Sunday in the week that started the Monday before', () => {
    const sunday = Date.parse('2026-11-29T23:59:59Z');
    assert.equal(new Date(weekStart(sunday)).toISOString(), '2026-11-23T00:00:00.000Z');
  });
});

describe('buildStats', () => {
  it('reports nothing scanned for a workspace with no finished scans', () => {
    const stats = buildStats([], NOW);
    assert.equal(stats.scanned, false);
    assert.deepEqual(stats.weeks, []);
    assert.equal(stats.totals.ok, 0);
    assert.equal(stats.previous, null);
  });

  it('adds up each client latest scan and splits it by engine', () => {
    const rows = [
      ...scanRows(1, 1, '2026-11-20T10:00:00Z', { chatgpt: 0, claude: 1 }),
      ...scanRows(1, 2, '2026-11-25T10:00:00Z', { chatgpt: 1, claude: 3, cited: 2 }),
      ...scanRows(2, 1, '2026-11-24T10:00:00Z', { chatgpt: 0, claude: 2, cited: 1 }),
    ];
    const stats = buildStats(rows, NOW);
    assert.equal(stats.scanned, true);
    assert.deepEqual(stats.totals, {
      ok: 20,
      mentioned: 6,
      cited: 3,
      doneFixes: 0,
      openFixes: 0,
    });
    assert.deepEqual(stats.byEngine, [
      { id: 'chatgpt', name: 'ChatGPT', ok: 10, mentioned: 1 },
      { id: 'claude', name: 'Claude', ok: 10, mentioned: 5 },
    ]);
  });

  it('gives a previous total only when every client has an earlier scan', () => {
    const one = [
      ...scanRows(1, 1, '2026-11-20T10:00:00Z', { claude: 1 }),
      ...scanRows(1, 2, '2026-11-25T10:00:00Z', { claude: 3 }),
    ];
    assert.deepEqual(buildStats(one, NOW).previous, { ok: 10, mentioned: 1 });

    const newClient = [...one, ...scanRows(2, 1, '2026-11-25T11:00:00Z', { claude: 2 })];
    assert.equal(buildStats(newClient, NOW).previous, null);
  });

  it('builds the week-by-week series from each client latest scan as of that week', () => {
    const rows = [
      ...scanRows(1, 1, '2026-11-10T10:00:00Z', { claude: 2 }),
      ...scanRows(1, 2, '2026-11-24T10:00:00Z', { chatgpt: 1, claude: 3 }),
    ];
    const { weeks } = buildStats(rows, NOW);
    assert.deepEqual(
      weeks.map((week) => [week.start.slice(0, 10), week.mentioned, week.ok]),
      [
        ['2026-11-09', 2, 10],
        ['2026-11-16', 2, 10],
        ['2026-11-23', 4, 10],
      ],
    );
    assert.ok(weeks.every((week) => week.fixesDone === 0));
  });

  it('starts the series at the first scan and never shows more than the last 8 weeks', () => {
    const early = [...scanRows(1, 1, '2026-08-03T10:00:00Z', { claude: 1 })];
    const { weeks } = buildStats(early, NOW);
    assert.equal(weeks.length, WEEKS_SHOWN);
    assert.equal(Date.parse(weeks.at(-1).start), weekStart(NOW));
    assert.equal(Date.parse(weeks[1].start) - Date.parse(weeks[0].start), WEEK_MS);
  });
});
