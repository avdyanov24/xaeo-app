import { methodNotAllowed } from '../lib/errors.js';

/**
 * Tiny method + path router. Patterns use `:name` segments, for example `/api/clients/:id`.
 * Handlers receive `(ctx)` where `ctx.params` holds the decoded segment values.
 */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const source = pattern
      .split('/')
      .map((part) => {
        if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(part.slice(1));
        return '([^/]+)';
      })
      .join('/');
    routes.push({ method, pattern, regex: new RegExp(`^${source}/?$`), keys, handler });
  }

  /**
   * @returns {{ handler: Function, params: Record<string, string> } | null}
   *   null when no route matches the path; throws 405 when the path exists for other methods.
   */
  function match(method, pathname) {
    const allowed = [];
    for (const route of routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
        allowed.push(route.method);
        continue;
      }
      const params = {};
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(found[i + 1])));
      return { handler: route.handler, params };
    }
    if (allowed.length) throw methodNotAllowed([...new Set(allowed)]);
    return null;
  }

  const verb = (method) => (pattern, handler) => add(method, pattern, handler);
  return {
    get: verb('GET'),
    post: verb('POST'),
    put: verb('PUT'),
    patch: verb('PATCH'),
    delete: verb('DELETE'),
    match,
    routes: () => routes.map(({ method, pattern }) => ({ method, pattern })),
  };
}
