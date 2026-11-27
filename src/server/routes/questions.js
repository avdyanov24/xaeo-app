import { readJson } from '../http/body.js';
import { validate } from '../lib/validate.js';
import { INTENTS } from '../repositories/question-repository.js';
import { suggestQuestions } from '../services/question-suggestions.js';
import { idParam } from './clients.js';

const TEXT = { type: 'string', min: 3, max: 200 };

const ADD = {
  text: { ...TEXT, required: true },
  intent: { type: 'enum', values: INTENTS, default: 'find' },
};

// Each field is optional; only the ones sent change.
const UPDATE = {
  text: TEXT,
  intent: { type: 'enum', values: INTENTS },
  active: { type: 'boolean' },
};

const SUGGEST = {
  name: { type: 'string', required: true, max: 100 },
  type: { type: 'string', max: 100, default: '' },
  city: { type: 'string', max: 100, default: '' },
};

/**
 * The questions each client is scanned with. Every route answers with the whole client, because
 * the questions page redraws from that one response.
 */
export function registerQuestionRoutes(router, { sessionHttp, clientService }) {
  const route = (handler) =>
    sessionHttp.requireUser((ctx) => handler(ctx, ctx.session.workspace.id));

  // Needs no client: the add-a-client page asks before the client exists.
  router.get(
    '/api/app/suggest',
    sessionHttp.requireUser((ctx) => ({
      questions: suggestQuestions(validate(SUGGEST, Object.fromEntries(ctx.url.searchParams))),
    })),
  );

  router.get(
    '/api/app/clients/:id/questions',
    route((ctx, workspaceId) => clientService.get(workspaceId, idParam(ctx.params)).questions),
  );

  router.post(
    '/api/app/clients/:id/questions',
    route(async (ctx, workspaceId) => {
      const input = validate(ADD, await readJson(ctx.req));
      return {
        status: 201,
        body: clientService.addQuestion(workspaceId, idParam(ctx.params), input),
      };
    }),
  );

  // The web app saves edits with POST, so both verbs are accepted.
  const update = route(async (ctx, workspaceId) =>
    clientService.updateQuestion(
      workspaceId,
      idParam(ctx.params),
      validate(UPDATE, await readJson(ctx.req)),
    ),
  );
  router.post('/api/app/questions/:id', update);
  router.patch('/api/app/questions/:id', update);

  const remove = route((ctx, workspaceId) =>
    clientService.deleteQuestion(workspaceId, idParam(ctx.params)),
  );
  // The web app deletes with POST /delete; DELETE is the same thing for other callers.
  router.post('/api/app/questions/:id/delete', remove);
  router.delete('/api/app/questions/:id', remove);
}
