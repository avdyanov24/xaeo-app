import { idParam } from './clients.js';

/** Reading the answers collected for a client. */
export function registerAnswerRoutes(router, { sessionHttp, answerService }) {
  const route = (handler) =>
    sessionHttp.requireUser((ctx) => handler(ctx, ctx.session.workspace.id));

  router.get(
    '/api/app/clients/:id/answers',
    route((ctx, workspaceId) => {
      const scan = ctx.url.searchParams.get('scan');
      return answerService.grid(
        workspaceId,
        idParam(ctx.params),
        scan === null ? null : idParam({ scan }, 'scan'),
      );
    }),
  );

  router.get(
    '/api/app/answers/:id',
    route((ctx, workspaceId) => answerService.detail(workspaceId, idParam(ctx.params))),
  );
}
