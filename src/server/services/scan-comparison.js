/**
 * How a scan's answers were collected, and whether a scan can be set beside the one before it. The
 * Answers tab and the client overview both show these, so the wording lives in one place.
 *
 * @typedef {import('../repositories/answer-repository.js').AnswerRow} AnswerRow
 */

/** The ids go to the browser as strings: the web app uses them as DOM data attributes and compares them as text. */
const publicId = (id) => String(id);

/**
 * What a scan says about how its answers were collected. Only facts this build records are listed;
 * the web app prints "Not recorded" for the rest, never today's settings in their place.
 * @param {AnswerRow[]} rows the scan's answers
 */
export function describeConfiguration(rows) {
  const questionIds = [...new Set(rows.map((row) => row.questionId))];
  return {
    state: 'recorded',
    source: 'sample',
    snapshot: {
      methodology: 'Scripted sample answers read from a fixed answer set',
      extractionVersion: 'Fixed matching rules',
      questions: questionIds.map(publicId),
      competitors: { mode: 'Business names found in the answer text' },
    },
    limitations: [
      'The answers are scripted sample data, so they show how the app works and do not describe how a live engine answers today.',
    ],
  };
}

/**
 * Says whether a scan can be set beside the one before it. Scans that asked different questions
 * measure different things, so they start a new baseline instead of showing a change.
 * @param {AnswerRow[]} rows the scan's answers
 * @param {AnswerRow[] | undefined} previousRows the earlier finished scan's answers, if there is one
 */
export function compareToPrevious(rows, previousRows) {
  if (!previousRows)
    return {
      comparable: false,
      reasons: [{ message: 'This is the first scan for this client, so it starts a baseline.' }],
    };
  const asked = new Set(rows.map((row) => row.questionId));
  const before = new Set(previousRows.map((row) => row.questionId));
  const same = asked.size === before.size && [...asked].every((id) => before.has(id));
  return same
    ? { comparable: true, reasons: [] }
    : {
        comparable: false,
        reasons: [
          {
            message:
              'The buyer questions changed since the previous scan, so this starts a new baseline.',
          },
        ],
      };
}
