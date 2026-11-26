import { ENGINES } from '../services/engines/engine.js';

/**
 * Xaeo asks ChatGPT and Claude. This build reads scripted answers, so every engine reports the
 * `sample` state and the mode is `sample`; the engines view words itself from those two fields.
 */
export function listEngines() {
  return {
    mode: 'sample',
    engines: Object.values(ENGINES).map(({ id, name, provider }) => ({
      id,
      name,
      provider,
      state: 'sample',
    })),
  };
}

/** Which engines scans ask, and where their answers come from. */
export function registerEngineRoutes(router, { sessionHttp }) {
  router.get(
    '/api/app/engines',
    sessionHttp.requireUser(() => listEngines()),
  );
}
