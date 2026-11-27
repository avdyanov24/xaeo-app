import { readJson } from '../http/body.js';
import { validationFailed } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { STATUSES } from '../services/fixes/fix-service.js';
import { idParam } from './clients.js';

const STATUS = { status: { type: 'enum', values: STATUSES, required: true } };

const CONDITION = {
  kind: { type: 'enum', values: ['title', 'schemaType'], required: true },
  value: { type: 'string', required: true, max: 200 },
};

const VERIFY = {
  beforeObservationId: { type: 'string', required: true, max: 100 },
  afterObservationId: { type: 'string', required: true, max: 100 },
  targetUrl: { type: 'string', required: true, max: 2048 },
  condition: { type: 'raw', required: true },
  reviewed: { type: 'boolean', required: true },
};

/** A client's fixes: the ranked list, marking one done or set aside, and comparing saved observations. */
export function registerFixRoutes(router, { sessionHttp, fixService }) {
  router.get(
    '/api/app/clients/:id/fixes',
    sessionHttp.requireUser((ctx) =>
      fixService.list(ctx.session.workspace.id, idParam(ctx.params)),
    ),
  );

  router.post(
    '/api/app/fixes/:id/status',
    sessionHttp.requireUser(async (ctx) => {
      const { status } = validate(STATUS, await readJson(ctx.req));
      return fixService.setStatus(ctx.session.workspace.id, idParam(ctx.params), status);
    }),
  );

  router.post(
    '/api/app/fixes/:id/verify',
    sessionHttp.requireOwner(async (ctx) => {
      const input = validate(VERIFY, await readJson(ctx.req));
      validate(CONDITION, input.condition);
      if (!input.reviewed)
        throw validationFailed([{ field: 'reviewed', message: 'must be confirmed' }]);
      return fixService.verify(ctx.session.workspace.id, idParam(ctx.params));
    }),
  );
}
