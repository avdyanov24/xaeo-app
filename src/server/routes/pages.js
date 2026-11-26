import { sendRedirect } from '../http/respond.js';

/**
 * Page routes: clean URLs for the HTML pages in `src/web`. The pages themselves and everything
 * they load (`/ui/...`, `/ds/...`, `/assets/...`) are plain static files.
 *
 * The app needs a session: without one, /app sends the browser to /login and comes back after
 * signing in. Signed-in users who open /login or /signup go straight to /app.
 */
export function registerPageRoutes(router, { staticFiles, sessionHttp }) {
  const page = (file) => (ctx) => staticFiles.serve(ctx.req, ctx.res, file);
  const signedIn = (ctx) => sessionHttp.currentSession(ctx.req) !== null;

  router.get('/', (ctx) => sendRedirect(ctx.res, signedIn(ctx) ? '/app' : '/login'));
  router.get('/app', (ctx) =>
    signedIn(ctx) ? page('/app.html')(ctx) : sendRedirect(ctx.res, '/login?next=%2Fapp'),
  );
  for (const name of ['login', 'signup'])
    router.get(`/${name}`, (ctx) =>
      signedIn(ctx) ? sendRedirect(ctx.res, '/app') : page(`/${name}.html`)(ctx),
    );
}
