import { idParam } from './clients.js';

/** Deleting a client: ask, cancel, and see what is pending. Owners only. */
export function registerLifecycleRoutes(router, { sessionHttp, lifecycleService }) {
  const owner = (action) =>
    sessionHttp.requireOwner((ctx) =>
      lifecycleService[action](ctx.session.workspace.id, idParam(ctx.params)),
    );

  router.get('/api/app/lifecycle/clients/:id', owner('get'));
  router.post('/api/app/lifecycle/clients/:id/deletion-request', owner('requestDeletion'));
  router.post('/api/app/lifecycle/clients/:id/deletion-cancel', owner('cancelDeletion'));
  // The client settings page asks from the client's own address.
  router.post('/api/app/clients/:id/deletion-request', owner('requestDeletion'));
}
