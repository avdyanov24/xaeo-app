import { registerAppRoutes } from './app.js';
import { registerAuthRoutes } from './auth.js';
import { registerClientRoutes } from './clients.js';
import { registerHealthRoutes } from './health.js';
import { registerPageRoutes } from './pages.js';
import { registerQuestionRoutes } from './questions.js';

/** Registers every route module on the router. New route modules are added here. */
export function registerRoutes(router, deps) {
  registerHealthRoutes(router, deps);
  registerAuthRoutes(router, deps);
  registerAppRoutes(router, deps);
  registerClientRoutes(router, deps);
  registerQuestionRoutes(router, deps);
  registerPageRoutes(router, deps);
}
