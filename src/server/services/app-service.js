import { ENGINES } from './engines/engine.js';

// Workspaces get their own timezone setting later; until then dates show in UK time,
// where the example agency works.
const DEFAULT_TIMEZONE = 'Europe/London';

/**
 * What the web app needs to start: who is signed in, their workspace, and which engines answer.
 * Answers come from the sample engine, so the engine bar says "Sample data".
 * @param {{ user: { id: number, email: string, name: string, role: string }, workspace: { id: number, name: string, role: string } }} session
 */
export function getAppContext({ user, workspace }) {
  const engines = Object.values(ENGINES).map(({ id, name }) => ({ id, name }));
  return {
    user: { ...user, workspaceRole: workspace.role },
    workspace: { id: workspace.id, name: workspace.name, timezone: DEFAULT_TIMEZONE },
    engines,
    engineStatus: {
      mode: 'sample',
      engines: engines.map((engine) => ({ ...engine, state: 'sample' })),
    },
  };
}
