import { registerHealthRoutes } from './health.js';
import { registerPageRoutes } from './pages.js';

/** Registers every route module on the router. New route modules are added here. */
export function registerRoutes(router, deps) {
  registerHealthRoutes(router, deps);
  registerPageRoutes(router, deps);
}
