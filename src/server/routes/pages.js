import { sendRedirect } from '../http/respond.js';

/**
 * Page routes: clean URLs for the HTML pages in `src/web`. The pages themselves and everything
 * they load (`/ui/...`, `/ds/...`, `/assets/...`) are plain static files.
 */
export function registerPageRoutes(router, { staticFiles }) {
  const page = (file) => (ctx) => staticFiles.serve(ctx.req, ctx.res, file);

  router.get('/', (ctx) => sendRedirect(ctx.res, '/app'));
  router.get('/app', page('/app.html'));
  // Served when the page exists; until then they answer with the standard 404 envelope.
  router.get('/login', page('/login.html'));
  router.get('/signup', page('/signup.html'));
}
