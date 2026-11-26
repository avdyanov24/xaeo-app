/**
 * An engine answers one buyer question the way an AI assistant would.
 *
 * @typedef {object} Citation
 * @property {string} url the page the answer cites
 * @property {string} [title] the page title, when the engine reports one
 *
 * @typedef {object} EngineAnswer
 * @property {string} text the answer as plain text
 * @property {Citation[]} citations sources the answer cites, in the order given
 *
 * @typedef {object} Engine
 * @property {string} id stable id, one of ENGINE_IDS
 * @property {string} name name shown to people
 * @property {(question: string) => Promise<EngineAnswer>} ask
 */

/** Xaeo asks these two engines and no others. */
export const ENGINES = Object.freeze({
  chatgpt: { id: 'chatgpt', name: 'ChatGPT', provider: 'OpenAI' },
  claude: { id: 'claude', name: 'Claude', provider: 'Anthropic' },
});

export const ENGINE_IDS = Object.freeze(Object.keys(ENGINES));

export const isEngineId = (value) => Object.hasOwn(ENGINES, value);

/** Raised when an engine cannot answer. Scans record it as a failed answer instead of crashing. */
export class EngineError extends Error {
  /**
   * @param {string} code stable snake_case code, for example `no_answer`
   * @param {string} message human-readable reason
   */
  constructor(code, message) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

/**
 * Checks that a value can be used as an engine, so a wiring mistake fails at start-up
 * and not on the first scan.
 * @param {unknown} engine
 * @returns {Engine}
 */
export function assertEngine(engine) {
  if (!engine || typeof engine !== 'object') throw new TypeError('An engine must be an object.');
  if (!isEngineId(engine.id)) throw new TypeError(`Unknown engine id: ${String(engine.id)}`);
  if (typeof engine.ask !== 'function')
    throw new TypeError(`Engine ${engine.id} must have an ask(question) function.`);
  return engine;
}
