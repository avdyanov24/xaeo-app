import { readJson } from '../http/body.js';
import { HttpError, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { INTENTS } from '../repositories/question-repository.js';
import { addSampleClient } from '../services/sample-client.js';

const DETAILS = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  domain: { type: 'string', required: true, max: 253 },
  type: { type: 'string', max: 100 },
  city: { type: 'string', max: 100 },
  country: { type: 'string', pattern: /^[A-Za-z]{2}$/ },
};

const CREATE = {
  ...DETAILS,
  questions: { type: 'raw' },
  scan: { type: 'boolean' },
};

// Every field is optional on update; only the ones sent change.
const UPDATE = {
  ...Object.fromEntries(
    Object.entries(DETAILS).map(([field, rule]) => [field, { ...rule, required: false }]),
  ),
  weekly: { type: 'boolean' },
};

const STARTER_QUESTION = {
  text: { type: 'string', required: true, min: 3, max: 200 },
  intent: { type: 'enum', values: INTENTS, default: 'find' },
};

/** Reads a numeric `:id` segment; anything else cannot match a row, so it is a 404. */
export function idParam(params, name = 'id') {
  if (!/^[1-9]\d{0,14}$/.test(params[name] ?? '')) throw notFound();
  return Number(params[name]);
}

/** Clients, the archive and the example client. */
export function registerClientRoutes(router, { sessionHttp, clientService, scanRunner, db }) {
  const route = (handler) =>
    sessionHttp.requireUser((ctx) => handler(ctx, ctx.session.workspace.id));

  router.get(
    '/api/app/clients',
    route((ctx, workspaceId) =>
      clientService.list(workspaceId, { archived: ctx.url.searchParams.get('archived') === '1' }),
    ),
  );

  router.post(
    '/api/app/clients',
    route(async (ctx, workspaceId) => {
      const input = upperCountry(validate(CREATE, await readJson(ctx.req)));
      const starters = (Array.isArray(input.questions) ? input.questions : [])
        .slice(0, 50)
        .map((question) => validate(STARTER_QUESTION, question));
      const { scan, ...details } = input;
      const { id } = clientService.create(workspaceId, { ...details, questions: starters });
      const body = { id };
      if (scan) {
        // The client is saved either way; a scan that cannot start says why instead of failing the request.
        try {
          scanRunner.startScan(workspaceId, id);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          body.scanNote = error.message;
        }
      }
      return { status: 201, body };
    }),
  );

  router.get(
    '/api/app/clients/:id',
    route((ctx, workspaceId) => clientService.get(workspaceId, idParam(ctx.params))),
  );

  // The web app saves edits with POST, so both verbs are accepted.
  const update = route(async (ctx, workspaceId) =>
    clientService.update(
      workspaceId,
      idParam(ctx.params),
      upperCountry(validate(UPDATE, await readJson(ctx.req))),
    ),
  );
  router.post('/api/app/clients/:id', update);
  router.patch('/api/app/clients/:id', update);

  router.post(
    '/api/app/clients/:id/archive',
    route((ctx, workspaceId) => clientService.archive(workspaceId, idParam(ctx.params))),
  );

  router.post(
    '/api/app/clients/:id/unarchive',
    route((ctx, workspaceId) => clientService.unarchive(workspaceId, idParam(ctx.params))),
  );

  router.post(
    '/api/app/sample',
    route(async (ctx, workspaceId) => {
      const { id, created } = await addSampleClient(db, workspaceId);
      return { status: created ? 201 : 200, body: { id } };
    }),
  );
}

/** Country codes are stored in capitals. */
const upperCountry = (input) =>
  input.country ? { ...input, country: input.country.toUpperCase() } : input;
