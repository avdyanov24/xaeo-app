import { EngineError } from '../engines/engine.js';
import { extractAnswer } from './extractor.js';

/** What the web app shows on a cell whose engine could not answer. */
export const FAILED_LABEL = 'Failed';

/**
 * Asks one engine one question and reads how the client appears in the reply. An `EngineError`
 * becomes a failed answer so the rest of the scan carries on; anything else is a bug and is thrown.
 *
 * @param {object} input
 * @param {import('../engines/engine.js').Engine} input.engine
 * @param {string} input.question the wording to ask
 * @param {import('./extractor.js').ExtractContext} input.context the client and competitors to look for
 * @returns {Promise<{ engine: string, status: 'ok' | 'failed' } & Record<string, unknown>>} fields ready for the answers table
 */
export async function collectAnswer({ engine, question, context }) {
  try {
    const answer = await engine.ask(question);
    const found = extractAnswer(answer, context);
    return {
      engine: engine.id,
      status: 'ok',
      text: answer.text,
      mentioned: found.mentioned,
      position: found.position,
      label: found.label,
      citations: found.citations,
      citedUrls: found.citedUrls,
      competitors: found.competitors,
    };
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    return { engine: engine.id, status: 'failed', error: error.message, label: FAILED_LABEL };
  }
}
