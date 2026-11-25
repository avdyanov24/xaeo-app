import { readFileSync } from 'node:fs';
import { ENGINE_IDS } from './engine.js';

const DEFAULT_FILE = new URL('./sample-answers.json', import.meta.url);

/** Questions are matched ignoring case, repeated spaces and a trailing question mark. */
export const questionKey = (question) =>
  String(question)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\?+$/, '')
    .toLowerCase();

/**
 * Checks the answer set once, so a typo in the file fails at start-up with a clear message
 * and a scan never meets a half-defined question.
 * @param {any} data parsed JSON
 */
export function validateAnswerSet(data) {
  const problems = [];
  const client = data?.client;
  if (!client?.name || !client?.domain) problems.push('client needs a name and a domain');
  if (!Array.isArray(data?.competitors)) problems.push('competitors must be a list of names');
  if (!Array.isArray(data?.questions) || data.questions.length === 0)
    problems.push('questions must be a non-empty list');

  for (const question of data?.questions ?? []) {
    const entry = data.answers?.[question];
    if (!entry) {
      problems.push(`"${question}" has no answers`);
      continue;
    }
    for (const engine of ENGINE_IDS) {
      const answer = entry[engine];
      if (typeof answer?.text !== 'string' || !answer.text.trim())
        problems.push(`"${question}" has no ${engine} answer text`);
      if (!Array.isArray(answer?.citations))
        problems.push(`"${question}" ${engine} citations must be a list`);
      else if (answer.citations.some((c) => !/^https?:\/\//.test(c?.url ?? '')))
        problems.push(`"${question}" ${engine} has a citation without an http(s) url`);
    }
    const unknown = Object.keys(entry).filter((id) => !ENGINE_IDS.includes(id));
    if (unknown.length) problems.push(`"${question}" has answers for unknown engines: ${unknown}`);
  }

  if (problems.length) throw new Error(`Invalid sample answer set:\n- ${problems.join('\n- ')}`);
  return data;
}

/**
 * Reads the sample answer set and indexes its answers by normalised question.
 * @param {URL | string} [file] JSON file to read, the Northside Plumbing set by default
 */
export function loadAnswerSet(file = DEFAULT_FILE) {
  const data = validateAnswerSet(JSON.parse(readFileSync(file, 'utf8')));
  const answers = new Map(
    data.questions.map((question) => [questionKey(question), data.answers[question]]),
  );
  return Object.freeze({
    client: data.client,
    competitors: data.competitors,
    questions: data.questions,
    /** @returns {Record<string, { text: string, citations: object[] }> | undefined} */
    answersFor: (question) => answers.get(questionKey(question)),
  });
}
