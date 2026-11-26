import { registerAnswerRoutes } from './answers.js';
import { registerAppRoutes } from './app.js';
import { registerAuthRoutes } from './auth.js';
import { registerClientRoutes } from './clients.js';
import { registerEngineRoutes } from './engines.js';
import { registerHealthRoutes } from './health.js';
import { registerPageRoutes } from './pages.js';
import { registerQuestionRoutes } from './questions.js';
import { registerScanRoutes } from './scans.js';

/** Registers every route module on the router. New route modules are added here. */
export function registerRoutes(router, deps) {
  registerHealthRoutes(router, deps);
  registerAuthRoutes(router, deps);
  registerAppRoutes(router, deps);
  registerClientRoutes(router, deps);
  registerAnswerRoutes(router, deps);
  registerEngineRoutes(router, deps);
  registerQuestionRoutes(router, deps);
  registerScanRoutes(router, deps);
  registerPageRoutes(router, deps);
}
