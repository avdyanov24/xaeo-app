/**
 * The numbers on a client's overview page, worked out from one scan's answers. Pure functions over
 * answer rows (see answer-repository.js), so every rule is easy to test.
 *
 * @typedef {import('../repositories/answer-repository.js').AnswerRow} AnswerRow
 */

/** Answers that came back; a failed answer carries no text and counts towards nothing. */
const returned = (rows) => rows.filter((row) => row.status === 'ok');

/** Rounds to one decimal and drops a trailing `.0`, so an average of 2 reads `2`, not `2.0`. */
const oneDecimal = (value) => Number(value.toFixed(1));

/**
 * Counts how often each business is named in the answers, most named first. Names are matched
 * ignoring case and the first spelling seen is kept. A business named twice in one answer counts once.
 * @param {AnswerRow[]} rows
 * @returns {{ name: string, count: number }[]} ties keep the order the names were first seen
 */
export function competitorsOf(rows) {
  const counts = new Map();
  for (const row of returned(rows)) {
    const seen = new Set();
    for (const name of row.competitors) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { name: name.trim(), count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * The four tiles under the headline number.
 * - `cited`: answers that name the client and cite its own site
 * - `avgPosition`: where the client usually sits when an answer lists several businesses, or null
 * - `firstPlace`: answers that list the client first
 * - `topRival`: the competitor named in most answers, or null when none is named
 * @param {AnswerRow[]} rows the scan's answers
 * @param {{ done: number, total: number }} fixes how many fixes are marked done, out of how many
 */
export function kpisOf(rows, fixes) {
  const ok = returned(rows);
  const positions = ok.filter((row) => row.mentioned && row.position !== null);
  const [topRival = null] = competitorsOf(rows);
  return {
    ok: ok.length,
    mentioned: ok.filter((row) => row.mentioned).length,
    cited: ok.filter((row) => row.label === 'Cited').length,
    avgPosition: positions.length
      ? oneDecimal(positions.reduce((sum, row) => sum + row.position, 0) / positions.length)
      : null,
    firstPlace: positions.filter((row) => row.position === 1).length,
    topRival,
    fixesDone: fixes.done,
    fixesTotal: fixes.total,
  };
}
