import * as clients from '../repositories/client-repository.js';
import * as questions from '../repositories/question-repository.js';
import * as workspaces from '../repositories/workspace-repository.js';
import { ENGINES } from './engines/engine.js';
import { publicWorkspace } from './workspace-service.js';

/**
 * The first-run checklist on the clients list. `brand` and `report` turn true when branding and
 * reports exist; until then they stay false and the checklist keeps those steps open.
 */
export function getOnboarding(db, workspaceId) {
  return {
    client: clients.listClients(db, workspaceId).length > 0,
    questions: questions.hasActiveQuestions(db, workspaceId),
    brand: false,
    report: false,
  };
}

/**
 * What the web app needs to start: who is signed in, their workspace with its brand and time zone,
 * which engines answer and how far through the first-run checklist the workspace is. Answers come from the sample engine, so the
 * engine bar says "Sample data". `xo` is true because Xo, the assistant panel, is part of this build:
 * the web app shows the panel, the Approvals page and their shortcuts only when it is set.
 * @param {{ user: { id: number, email: string, name: string, role: string }, workspace: { id: number, name: string, role: string } }} session
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function getAppContext({ user, workspace }, db) {
  const engines = Object.values(ENGINES).map(({ id, name }) => ({ id, name }));
  return {
    onboarding: getOnboarding(db, workspace.id),
    user: { ...user, workspaceRole: workspace.role },
    workspace: publicWorkspace(workspaces.findWorkspaceSettings(db, workspace.id)),
    engines,
    xo: true,
    engineStatus: {
      mode: 'sample',
      engines: engines.map((engine) => ({ ...engine, state: 'sample' })),
    },
  };
}
