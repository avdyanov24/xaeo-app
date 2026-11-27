import { registerAnswerRoutes } from './answers.js';
import { registerAppRoutes } from './app.js';
import { registerAuthRoutes } from './auth.js';
import { registerClientRoutes } from './clients.js';
import { registerEngineRoutes } from './engines.js';
import { registerFixRoutes } from './fixes.js';
import { registerHealthRoutes } from './health.js';
import { registerPageRoutes } from './pages.js';
import { registerQuestionRoutes } from './questions.js';
import { registerScanRoutes } from './scans.js';
import { registerWorkspaceRoutes } from './workspace.js';
import { registerXoRoutes } from './xo.js';

/** Registers every route module on the router. New route modules are added here. */
export function registerRoutes(router, deps) {
  registerHealthRoutes(router, deps);
  registerAuthRoutes(router, deps);
  registerAppRoutes(router, deps);
  registerClientRoutes(router, deps);
  registerAnswerRoutes(router, deps);
  registerEngineRoutes(router, deps);
  registerFixRoutes(router, deps);
  registerQuestionRoutes(router, deps);
  registerScanRoutes(router, deps);
  registerXoRoutes(router, deps);
  registerWorkspaceRoutes(router, deps);
  registerPageRoutes(router, deps);
}
