import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';

/** Registers every route module on the router. New route modules are added here. */
export function registerRoutes(router, deps) {
  registerHealthRoutes(router, deps);
  registerAuthRoutes(router, deps);
}
