import { getAppContext } from '../services/app-service.js';

/** Routes the signed-in web app calls. */
export function registerAppRoutes(router, { sessionHttp }) {
  router.get(
    '/api/app/me',
    sessionHttp.requireUser(({ session }) => getAppContext(session)),
  );
}
