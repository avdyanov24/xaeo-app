import { readBuffer, readJson } from '../http/body.js';
import { validate } from '../lib/validate.js';
import { getAppContext } from '../services/app-service.js';
import { exportWorkspace } from '../services/workspace-export.js';
import { DEFAULT_BRAND_COLOR, MAX_LOGO_BYTES } from '../services/workspace-service.js';

const BRAND = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  color: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/, default: DEFAULT_BRAND_COLOR },
  website: { type: 'string', max: 200, default: '' },
  contact: { type: 'string', max: 200, default: '' },
};

const TIMEZONE = { timezone: { type: 'string', required: true, max: 64 } };

/** The media type of a request: the header without parameters such as `; charset=utf-8`. */
const mediaType = (req) => (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();

/** The agency's own settings: brand, logo and time zone. Reading is for any member, changing is for owners. */
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

  router.post(
    '/api/app/brand/logo',
    sessionHttp.requireOwner(async (ctx) => {
      const data = await readBuffer(ctx.req, { limit: MAX_LOGO_BYTES });
      workspaceService.setLogo(ctx.session.workspace.id, { data, type: mediaType(ctx.req) });
      return context(ctx);
    }),
  );

  router.post(
    '/api/app/brand/logo/delete',
    sessionHttp.requireOwner((ctx) => {
      workspaceService.removeLogo(ctx.session.workspace.id);
      return context(ctx);
    }),
  );

  // The file is sent with a policy that blocks scripts, so an SVG opened directly cannot run any.
  router.get(
    '/api/app/brand/logo',
    sessionHttp.requireUser((ctx) => {
      const { data, type } = workspaceService.logo(ctx.session.workspace.id);
      ctx.res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': data.length,
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        // The URL carries the upload time, so a new logo is a new URL and an old one can be kept.
        'Cache-Control': 'private, max-age=86400',
      });
      ctx.res.end(ctx.req.method === 'HEAD' ? undefined : data);
    }),
  );

  router.post(
    '/api/app/workspace/timezone',
    sessionHttp.requireOwner(async (ctx) => {
      const { timezone } = validate(TIMEZONE, await readJson(ctx.req));
      return workspaceService.setTimezone(ctx.session.workspace.id, timezone);
    }),
  );

  // Everything the workspace holds, as a download the owner can keep.
  router.get(
    '/api/app/export',
    sessionHttp.requireOwner((ctx) => {
      const body = JSON.stringify(exportWorkspace(db, ctx.session.workspace.id), null, 2);
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="xaeo-workspace-export.json"',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      ctx.res.end(ctx.req.method === 'HEAD' ? undefined : body);
    }),
  );
}
