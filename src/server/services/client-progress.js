/**
 * What the clients list shows besides a client's own details: how its scans have trended and the
 * one thing worth doing next. Pure functions over numbers, so the rules are easy to test.
 */

/** The sparkline needs at least three points, so the list keeps this many of the latest scans. */
export const HISTORY_LENGTH = 8;

/**
 * @param {{ ok: number, mentioned: number }[]} history finished scans, oldest first
 * @returns {number | null} how many more answers name the client than in the scan before, or null
 *   when there is no earlier scan to compare with
 */
export function deltaOf(history) {
  if (history.length < 2) return null;
  return history.at(-1).mentioned - history.at(-2).mentioned;
}

/**
 * The button on a client's card. `run` starts a scan from the list; `tab` opens that page of the client.
 * @param {{ status: string, questions: number, fixes: { todo: number }, latest: object | null }} client
 * @returns {{ label: string, run: true } | { label: string, tab: string }}
 */
export function nextActionOf(client) {
  if (client.status === 'archived') return { label: 'Open', tab: 'overview' };
  if (client.questions === 0) return { label: 'Add questions', tab: 'questions' };
  if (!client.latest) return { label: 'Run first scan', run: true };
  if (client.fixes.todo > 0) return { label: 'Review fixes', tab: 'fixes' };
  return { label: 'Run a scan', run: true };
}
