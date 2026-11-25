import { EngineError, ENGINES } from './engine.js';
import { loadAnswerSet } from './sample-answers.js';

/**
 * An engine that reads scripted answers instead of calling a provider, so sample data
 * gives the same result on every scan and nothing leaves the machine.
 * @param {keyof typeof ENGINES} id which engine's answers to read
 * @param {ReturnType<typeof loadAnswerSet>} [answerSet]
 * @returns {import('./engine.js').Engine}
 */
export function createSampleEngine(id, answerSet = loadAnswerSet()) {
  const engine = ENGINES[id];
  if (!engine) throw new TypeError(`Unknown engine id: ${String(id)}`);

  return Object.freeze({
    id: engine.id,
    name: engine.name,
    async ask(question) {
      const answer = answerSet.answersFor(question)?.[id];
      if (!answer) {
        throw new EngineError('no_answer', `No sample answer for "${String(question).trim()}".`);
      }
      // Copies, so a caller can never change the shared answer set.
      return { text: answer.text, citations: answer.citations.map((c) => ({ ...c })) };
    },
  });
}

/** Both engines, reading the same answer set. */
export function createSampleEngines(answerSet = loadAnswerSet()) {
  return Object.keys(ENGINES).map((id) => createSampleEngine(id, answerSet));
}
