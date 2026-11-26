import { getAppContext } from '../services/app-service.js';

/** Routes the signed-in web app calls. */
export function registerAppRoutes(router, { sessionHttp, statsService, db }) {
  router.get(
    '/api/app/me',
    sessionHttp.requireUser(({ session }) => getAppContext(session, db)),
  );

  router.get(
    '/api/app/stats',
    sessionHttp.requireUser(({ session }) => statsService.forWorkspace(session.workspace.id)),
  );
}
