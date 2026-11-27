import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareScans,
  competitorsOf,
  kpisOf,
  sourcesOf,
} from '../../src/server/services/overview-metrics.js';

let nextId = 1;

/** An answer row with the fields the metrics read; anything else is left at its default. */
function answer(fields = {}) {
  return {
    id: nextId++,
    status: 'ok',
    mentioned: false,
    position: null,
    label: 'Not mentioned',
    competitors: [],
    citations: [],
    ...fields,
  };
}

const NO_FIXES = { done: 0, total: 0 };

describe('competitorsOf', () => {
  it('counts the answers that name each business, most named first', () => {
    const rows = [
      answer({ competitors: ['CityPipe'] }),
      answer({ competitors: ['RapidFlow', 'CityPipe'] }),
      answer({ competitors: ['CityPipe'] }),
    ];
    assert.deepEqual(competitorsOf(rows), [
      { name: 'CityPipe', count: 3 },
      { name: 'RapidFlow', count: 1 },
    ]);
  });

  it('matches names ignoring case and keeps the first spelling', () => {
    const rows = [
      answer({ competitors: ['CityPipe'] }),
      answer({ competitors: ['citypipe'] }),
      answer({ competitors: ['CITYPIPE'] }),
    ];
    assert.deepEqual(competitorsOf(rows), [{ name: 'CityPipe', count: 3 }]);
  });

  it('counts a business once per answer even when the list repeats it', () => {
    const rows = [answer({ competitors: ['CityPipe', 'citypipe'] })];
    assert.deepEqual(competitorsOf(rows), [{ name: 'CityPipe', count: 1 }]);
  });

  it('ignores failed answers and blank names', () => {
    const rows = [
      answer({ status: 'failed', competitors: ['CityPipe'] }),
      answer({ competitors: ['  '] }),
    ];
    assert.deepEqual(competitorsOf(rows), []);
  });

  it('keeps first-seen order between equal counts', () => {
    const rows = [answer({ competitors: ['RapidFlow', 'CityPipe'] })];
    assert.deepEqual(
      competitorsOf(rows).map((c) => c.name),
      ['RapidFlow', 'CityPipe'],
    );
  });
});

describe('kpisOf', () => {
  it('is all zeros and nulls for a scan with no answers', () => {
    assert.deepEqual(kpisOf([], NO_FIXES), {
      ok: 0,
      mentioned: 0,
      cited: 0,
      avgPosition: null,
      firstPlace: 0,
      topRival: null,
      fixesDone: 0,
      fixesTotal: 0,
    });
  });

  it('counts returned, named and cited answers; a failed answer counts towards none', () => {
    const rows = [
      answer({ mentioned: true, position: 1, label: 'Cited' }),
      answer({ mentioned: true, position: 3, label: 'Mentioned' }),
      answer(),
      answer({ status: 'failed', mentioned: true, label: 'Cited' }),
    ];
    const kpis = kpisOf(rows, NO_FIXES);
    assert.equal(kpis.ok, 3);
    assert.equal(kpis.mentioned, 2);
    assert.equal(kpis.cited, 1);
  });

  it('averages the client position over the answers that name it, to one decimal', () => {
    const rows = [
      answer({ mentioned: true, position: 1 }),
      answer({ mentioned: true, position: 2 }),
      answer({ mentioned: true, position: 2 }),
      answer(),
    ];
    const kpis = kpisOf(rows, NO_FIXES);
    assert.equal(kpis.avgPosition, 1.7);
    assert.equal(kpis.firstPlace, 1);
  });

  it('shows a whole-number average without a decimal and has no average when never named', () => {
    assert.equal(kpisOf([answer({ mentioned: true, position: 2 })], NO_FIXES).avgPosition, 2);
    assert.equal(kpisOf([answer(), answer()], NO_FIXES).avgPosition, null);
  });

  it('names the top competitor and passes the fix counts through', () => {
    const rows = [
      answer({ competitors: ['CityPipe', 'RapidFlow'] }),
      answer({ competitors: ['CityPipe'] }),
    ];
    const kpis = kpisOf(rows, { done: 1, total: 4 });
    assert.deepEqual(kpis.topRival, { name: 'CityPipe', count: 2 });
    assert.equal(kpis.fixesDone, 1);
    assert.equal(kpis.fixesTotal, 4);
  });
});

describe('sourcesOf', () => {
  const cite = (domain) => ({ url: `https://${domain}/page`, title: 'Page', domain });

  it('counts the answers that cite each site, most cited first', () => {
    const rows = [
      answer({ citations: [cite('citypipe.example')] }),
      answer({ citations: [cite('rapidflow.example'), cite('citypipe.example')] }),
    ];
    assert.deepEqual(sourcesOf(rows, 'northsideplumbing.co.uk'), [
      { name: 'citypipe.example', kind: 'Other site', count: 2 },
      { name: 'rapidflow.example', kind: 'Other site', count: 1 },
    ]);
  });

  it('counts a site once per answer however many of its pages are cited', () => {
    const rows = [answer({ citations: [cite('citypipe.example'), cite('citypipe.example')] })];
    assert.equal(sourcesOf(rows, 'northsideplumbing.co.uk')[0].count, 1);
  });

  it("marks the client's own site and its subdomains", () => {
    const rows = [
      answer({
        citations: [cite('northsideplumbing.co.uk'), cite('blog.northsideplumbing.co.uk')],
      }),
      answer({ citations: [cite('notnorthsideplumbing.co.uk')] }),
    ];
    const kinds = Object.fromEntries(
      sourcesOf(rows, 'northsideplumbing.co.uk').map((s) => [s.name, s.kind]),
    );
    assert.deepEqual(kinds, {
      'northsideplumbing.co.uk': 'Client site',
      'blog.northsideplumbing.co.uk': 'Client site',
      'notnorthsideplumbing.co.uk': 'Other site',
    });
  });

  it('ignores failed answers', () => {
    const rows = [answer({ status: 'failed', citations: [cite('citypipe.example')] })];
    assert.deepEqual(sourcesOf(rows, 'northsideplumbing.co.uk'), []);
  });
});

describe('compareScans', () => {
  const pair = (questionId, engine, fields = {}) =>
    answer({ questionId, engine, questionText: `Question ${questionId}`, ...fields });

  it('lists answers that now name the client as gained and answers that stopped as lost', () => {
    const before = [
      pair(1, 'chatgpt'),
      pair(1, 'claude', { mentioned: true }),
      pair(2, 'chatgpt', { mentioned: true }),
    ];
    const now = [
      pair(1, 'chatgpt', { mentioned: true }),
      pair(1, 'claude', { mentioned: true }),
      pair(2, 'chatgpt'),
    ];
    const { changes, comparison } = compareScans(now, before);
    assert.deepEqual(changes.gained, [
      { answerId: String(now[0].id), engine: 'ChatGPT', question: 'Question 1' },
    ]);
    assert.deepEqual(changes.lost, [
      { answerId: String(now[2].id), engine: 'ChatGPT', question: 'Question 2' },
    ]);
    assert.deepEqual(comparison, {
      matchedPairs: 3,
      previousOk: 3,
      currentOk: 3,
      complete: true,
    });
  });

  it('only compares pairs that returned an answer both times and says coverage changed', () => {
    const before = [pair(1, 'chatgpt'), pair(1, 'claude', { status: 'failed' })];
    const now = [
      pair(1, 'chatgpt', { mentioned: true }),
      pair(1, 'claude', { mentioned: true }),
      pair(2, 'chatgpt', { mentioned: true }),
    ];
    const { changes, comparison } = compareScans(now, before);
    assert.equal(changes.gained.length, 1);
    assert.deepEqual(comparison, {
      matchedPairs: 1,
      previousOk: 1,
      currentOk: 3,
      complete: false,
    });
  });

  it('reports no change when nothing differs', () => {
    const rows = [pair(1, 'chatgpt', { mentioned: true }), pair(1, 'claude')];
    const { changes } = compareScans(rows, rows);
    assert.deepEqual(changes, { gained: [], lost: [] });
  });
});
