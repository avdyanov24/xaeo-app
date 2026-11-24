/** Liveness probe used by Docker and CI smoke tests. */
export function registerHealthRoutes(router, { version, startedAt }) {
  router.get('/api/health', () => ({
    status: 'ok',
    version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));
}
