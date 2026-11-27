import { readJson } from '../http/body.js';
import { validate } from '../lib/validate.js';
import { getAppContext } from '../services/app-service.js';
import { DEFAULT_BRAND_COLOR } from '../services/workspace-service.js';

const BRAND = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  color: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/, default: DEFAULT_BRAND_COLOR },
  website: { type: 'string', max: 200, default: '' },
  contact: { type: 'string', max: 200, default: '' },
};

/** The agency's own settings. Changing them is for workspace owners. */
export function registerWorkspaceRoutes(router, { sessionHttp, workspaceService, db }) {
  // Settings answers with the app context, so the page can refresh what it keeps from /api/app/me.
  const context = (ctx) => getAppContext(ctx.session, db);

  router.post(
    '/api/app/brand',
    sessionHttp.requireOwner(async (ctx) => {
      const input = validate(BRAND, await readJson(ctx.req));
      workspaceService.updateBrand(ctx.session.workspace.id, {
        ...input,
        color: input.color.toUpperCase(),
      });
      return context(ctx);
    }),
  );
}
