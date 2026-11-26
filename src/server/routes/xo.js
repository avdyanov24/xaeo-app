import { setTimeout as sleep } from 'node:timers/promises';
import { readJson } from '../http/body.js';
import { validationFailed } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { idParam } from './clients.js';

/** The longest message Xo reads; the panel stops typing at the same length. */
const MAX_TEXT = 4000;

const TURN = {
  conversationId: { type: 'integer', min: 1 },
  text: { type: 'string', required: true, min: 1, max: MAX_TEXT },
  // Where the person is in the app, so "this client" means the one they have open.
  uiState: { type: 'raw' },
};

const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'stale', 'all'];

const DECIDE = {
  decision: { type: 'enum', values: ['approve', 'reject'], required: true },
  // The hash of the content the person reviewed; a draft that changed since is refused.
  contentHash: { type: 'string', required: true, min: 64, max: 64 },
};

const EDIT = {
  version: { type: 'integer', required: true, min: 1 },
  title: { type: 'string', min: 1, max: 200 },
  // Code keeps its whitespace, so it is not trimmed like the other fields.
  code: { type: 'raw' },
  fill: { type: 'raw' },
};

const APPLY = { approvalId: { type: 'integer', required: true, min: 1 } };

const MAX_CODE = 50_000;
const MAX_FILL = 500;

/** Checks the free-form parts of an edit: code is text, and fill maps placeholder names to text. */
function checkEdit(input) {
  const issues = [];
  if (input.code !== undefined && (typeof input.code !== 'string' || input.code.length > MAX_CODE))
    issues.push({ field: 'code', message: `must be text of at most ${MAX_CODE} characters` });
  if (input.fill !== undefined) {
    const entries =
      input.fill && typeof input.fill === 'object' && !Array.isArray(input.fill)
        ? Object.entries(input.fill)
        : null;
    if (!entries || entries.some(([, v]) => typeof v !== 'string' || v.length > MAX_FILL))
      issues.push({
        field: 'fill',
        message: `must map names to text of at most ${MAX_FILL} characters`,
      });
  }
  if (issues.length) throw validationFailed(issues);
  return input;
}

/** Writes one server-sent event. */
const frame = ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Xo, the assistant panel. `POST /api/app/xo/turn` answers with a server-sent event stream; the
 * other routes are plain JSON. Replies come from the scripted reply set, so no request leaves the server.
 */
export function registerXoRoutes(
  router,
  { sessionHttp, chatService, artifactService, xoWordDelayMs },
) {
  const route = (handler) => sessionHttp.requireUser((ctx) => handler(ctx, ctx.session));

  router.post(
    '/api/app/xo/turn',
    route(async (ctx, session) => {
      const input = validate(TURN, await readJson(ctx.req));
      // Everything that can fail has happened by now, so a refused message is a plain JSON error.
      const events = chatService.startTurn(session, input);
      const { res } = ctx;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      for (const event of events) {
        if (res.destroyed) return;
        res.write(frame(event));
        if (event.event === 'text' && xoWordDelayMs) await sleep(xoWordDelayMs);
      }
      res.end();
    }),
  );

  router.get(
    '/api/app/xo/conversations',
    route((ctx, session) => chatService.listConversations(session)),
  );

  router.get(
    '/api/app/xo/conversations/:id',
    route((ctx, session) => chatService.getConversation(session, idParam(ctx.params))),
  );

  router.get(
    '/api/app/xo/suggestions',
    route((ctx, session) =>
      chatService.suggestions(session, { clientId: ctx.url.searchParams.get('clientId') }),
    ),
  );

  router.get(
    '/api/app/xo/usage',
    route(() => chatService.usage()),
  );

  router.get(
    '/api/app/xo/approvals',
    route((ctx, session) => {
      const query = ctx.url.searchParams;
      const filters = validate(
        {
          status: { type: 'enum', values: APPROVAL_STATUSES, default: 'pending' },
          clientId: { type: 'integer', min: 1 },
        },
        Object.fromEntries(query),
      );
      return artifactService.listApprovals(session, filters);
    }),
  );

  router.post(
    '/api/app/xo/approvals/:id/decide',
    route(async (ctx, session) =>
      artifactService.decide(
        session,
        idParam(ctx.params),
        validate(DECIDE, await readJson(ctx.req)),
      ),
    ),
  );

  router.get(
    '/api/app/xo/artifacts/:id',
    route((ctx, session) => artifactService.get(session, idParam(ctx.params))),
  );

  router.post(
    '/api/app/xo/artifacts/:id/edit',
    route(async (ctx, session) => {
      const input = checkEdit(validate(EDIT, await readJson(ctx.req)));
      return artifactService.edit(session, idParam(ctx.params), input);
    }),
  );

  router.post(
    '/api/app/xo/artifacts/:id/apply',
    route(async (ctx, session) =>
      artifactService.apply(session, idParam(ctx.params), validate(APPLY, await readJson(ctx.req))),
    ),
  );

  // Sent as an attachment, so the browser saves it without leaving the page.
  router.get(
    '/api/app/xo/artifacts/:id/download',
    route((ctx, session) => {
      const file = artifactService.download(session, idParam(ctx.params));
      ctx.res.writeHead(200, {
        'Content-Type': file.type,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Length': Buffer.byteLength(file.body),
        'Cache-Control': 'no-store',
      });
      ctx.res.end(ctx.req.method === 'HEAD' ? undefined : file.body);
    }),
  );
}
