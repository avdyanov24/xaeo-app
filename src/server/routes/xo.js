import { setTimeout as sleep } from 'node:timers/promises';
import { readJson } from '../http/body.js';
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

/** Writes one server-sent event. */
const frame = ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Xo, the assistant panel. `POST /api/app/xo/turn` answers with a server-sent event stream; the
 * other routes are plain JSON. Replies come from the scripted reply set, so no request leaves the server.
 */
export function registerXoRoutes(router, { sessionHttp, chatService, xoWordDelayMs }) {
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
}
