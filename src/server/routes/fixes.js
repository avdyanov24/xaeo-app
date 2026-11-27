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

// A file of fixes: ids as the page has them, a hundred at a time.
const HANDOFF = {
  fixIds: { type: 'raw', required: true },
  channel: { type: 'enum', values: ['csv'], required: true },
};
const MAX_HANDOFF_IDS = 100;
const FIX_ID = /^[1-9]\d{0,14}$/;

const VERIFY = {
  beforeObservationId: { type: 'string', required: true, max: 100 },
  afterObservationId: { type: 'string', required: true, max: 100 },
  targetUrl: { type: 'string', required: true, max: 2048 },
  condition: { type: 'raw', required: true },
  reviewed: { type: 'boolean', required: true },
};

/** A client's fixes: the ranked list, marking one done or set aside, comparing saved observations, and the CSV handoff. */
export function registerFixRoutes(router, { sessionHttp, fixService, fixExportService }) {
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

  router.get(
    '/api/app/clients/:id/fixes.csv',
    sessionHttp.requireUser((ctx) => {
      const { filename, body } = fixExportService.csv(
        ctx.session.workspace.id,
        idParam(ctx.params),
        { onlyNew: ctx.url.searchParams.get('only') === 'new' },
      );
      ctx.res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      ctx.res.end(ctx.req.method === 'HEAD' ? undefined : body);
    }),
  );

  router.get(
    '/api/app/clients/:id/handoffs',
    sessionHttp.requireUser((ctx) =>
      fixExportService.handoffs(ctx.session.workspace.id, idParam(ctx.params)),
    ),
  );

  router.post(
    '/api/app/clients/:id/handoffs',
    sessionHttp.requireUser(async (ctx) => {
      const { fixIds } = validate(HANDOFF, await readJson(ctx.req));
      if (
        !Array.isArray(fixIds) ||
        fixIds.length < 1 ||
        fixIds.length > MAX_HANDOFF_IDS ||
        !fixIds.every((id) => typeof id === 'string' && FIX_ID.test(id))
      )
        throw validationFailed([
          { field: 'fixIds', message: `must be 1 to ${MAX_HANDOFF_IDS} fix ids` },
        ]);
      return fixExportService.recordHandoffs(ctx.session.workspace.id, idParam(ctx.params), fixIds);
    }),
  );
}
