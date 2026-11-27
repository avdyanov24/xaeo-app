# Architecture

Xaeo is a single Node.js process that serves a JSON API under `/api`. It uses ES modules, has no framework and no build step. The reasons are recorded in [ADR 0001](adr/0001-plain-node-layered-architecture.md).

## Request lifecycle

1. `src/server/index.js` loads configuration, creates the logger and starts `node:http`.
2. `src/server/app.js` handles every request: it assigns an `X-Request-Id`, sets security headers and asks the router for a handler.
3. `src/server/http/router.js` matches the method and path (`/api/clients/:id` style patterns). An unknown path is a 404; a known path with the wrong method is a 405 with an `Allow` header. A `GET` or `HEAD` that matches no route and is not under `/api` falls through to the static files (see below).
4. The route handler validates its input and calls a service.
5. The handler's return value is sent as JSON with `Cache-Control: no-store`. Returning `{ status, body }` sets the status; returning nothing sends 204.
6. Any thrown `HttpError` becomes the JSON error envelope. Anything else is logged with its stack and the request id, and the client gets a generic 500.
7. One structured log line is written per request with the method, path, status and duration.

## Web app and static files

The browser UI is plain HTML, CSS and JavaScript in `src/web`, with no build step. `src/server/http/static.js` serves it: it maps a URL path to a file below `src/web`, sets the content type from the extension, adds an `ETag` and a cache policy (HTML always revalidates, other files cache for five minutes) and answers `HEAD` and conditional requests. A path is refused with a 404 when any segment starts with a dot, when it contains an encoded separator, backslash or NUL byte, or when the real path of the file (after following symlinks) is outside `src/web`.

`src/server/routes/pages.js` adds the clean page URLs: `/` redirects to `/app`, and `/app`, `/login` and `/signup` serve their HTML file. The UI keeps all HTTP calls in `src/web/ui/js/lib.js` and each screen in `src/web/ui/js/views/`; it knows nothing about the server's layers beyond the JSON routes in [api.md](api.md).

## Layers

Dependencies point one way: `routes` -> `services` -> `repositories`. `lib` is shared by all layers and depends on none of them.

| Layer        | Folder                    | Responsibility                                                  | Must not                        |
| ------------ | ------------------------- | --------------------------------------------------------------- | ------------------------------- |
| HTTP         | `src/server/http`         | Routing, body parsing with size limits, response helpers        | know about business concepts    |
| Routes       | `src/server/routes`       | Read params and body, validate, call a service, return a result | contain business rules or SQL   |
| Services     | `src/server/services`     | Business logic                                                  | touch `req` or `res`            |
| Repositories | `src/server/repositories` | SQL with bound parameters, mapping rows to camelCase objects    | hold business rules             |
| Shared       | `src/server/lib`          | Errors, logger, validation                                      | import from other server layers |

New route modules are registered in `src/server/routes/index.js`.

## Database

SQLite through the built-in `node:sqlite` driver, one file per deployment (`DATABASE_PATH`). `src/server/db/database.js` opens it with foreign keys on and WAL journaling, and offers `transaction(db, work)`.

Schema changes are plain SQL files in `src/server/db/migrations`, named `NNN_name.sql`. On every start `src/server/db/migrate.js` applies the ones not yet listed in `schema_migrations`, in order, each in its own transaction. Tables are `STRICT`, and every table that holds agency data carries a `workspace_id`.

## Seed data

`src/server/db/seed/index.js` runs seed steps in order; each step is idempotent and lives in its own file (`accounts.js` creates Brightline Digital and the test accounts). `npm run db:seed` (`scripts/db-seed.js`) runs them against `DATABASE_PATH`, and `npm run db:reset` (`scripts/db-reset.js`) deletes the database first. Both refuse to run in production.

## Accounts and sessions

`001_identity.sql` adds `users`, `workspaces`, `memberships` (owner or member) and `sessions`. Signing up creates a user and a workspace they own. A user's `role` is `user` or `admin`.

`src/server/services/auth-service.js` signs users up and in, and resolves sessions. `src/server/http/session.js` reads and writes the `xaeo_session` cookie and provides route guards:

```js
router.get(
  '/api/app/me',
  sessionHttp.requireUser(({ session }) => session.user),
);
router.get(
  '/api/admin/users',
  sessionHttp.requireAdmin(() => listUsers()),
);
```

A guarded handler receives `ctx.session` with `user` and `workspace`; services take `session.workspace.id` to scope their queries. The reasoning is in [ADR 0002](adr/0002-cookie-sessions-and-scrypt.md).

## Clients, questions, scans and answers

`002_clients_scans.sql` adds four tables, each with a `workspace_id` so every query can be scoped to the signed-in workspace:

- `clients`: the businesses an agency tracks. Archiving sets `archived_at` and keeps the row. `sample = 1` marks the example client.
- `questions`: the buyer questions for a client. A deleted question keeps its row (`deleted_at`) so old answers still show the wording they were asked with.
- `scans`: one run of every active question against every engine. `state` is `queued`, `running`, `done`, `failed` or `cancelled`, and `number` counts up per client.
- `answers`: one engine's answer to one question in one scan, with the extracted mention, position, label, citations and competitors. `(scan_id, question_id, engine)` is unique.

Each table has a repository in `src/server/repositories` that takes the workspace id and returns plain objects. Scans run in the server process (`src/server/services/scans/scan-runner.js`): there is no job queue. The runner asks one question at a time through an engine (`src/server/services/engines`), stores each answer as it arrives, and re-reads the scan row around every answer so a cancel takes effect before the next answer is stored. The web app polls `GET /api/app/scans/:id` to show progress. A scan that was still running when the server stopped is marked failed on start-up and can be retried. The only engine implementation is the `sample` engine, which reads the scripted Northside Plumbing answers; `GET /api/app/engines` lists ChatGPT and Claude with the state `sample`, because this build serves their answers from that scripted set.

## Errors

Services and routes throw `HttpError` (or one of the helpers in `src/server/lib/errors.js`). Every error response has the same shape:

```json
{ "error": { "code": "validation_failed", "message": "Some fields are invalid.", "issues": [] } }
```

`code` is stable and safe for clients to branch on; `message` is safe to show to users. Internal details never leave the server.

## Input validation

`src/server/lib/validate.js` checks input against a declarative schema. It trims strings, coerces integer strings, applies defaults, drops unknown fields and reports every problem at once as a 422. JSON bodies are read by `src/server/http/body.js`, which enforces a size limit (100 KB by default) and the `application/json` content type.

## Configuration

`src/server/config.js` reads environment variables once at start-up and returns a frozen object. Invalid values stop the process with a message that lists every problem. The variables are documented in the [README](../README.md#configuration).

## Logging

`src/server/lib/logger.js` writes one JSON object per line: `time`, `level`, `message` and context fields such as `requestId`. Errors go to stderr. Tests run with the `silent` level.

## Security baseline

- Security headers on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`.
- Request bodies are size-limited and must be JSON.
- Passwords are hashed with scrypt; sessions are random tokens stored only as SHA-256 hashes, in an `HttpOnly`, `SameSite=Lax` cookie that is `Secure` in production.
- Repositories use bound parameters only.
- Unexpected errors return a generic message; stacks stay in the server log.
- The Docker image runs as the non-root `node` user.
- Dependabot watches npm packages, GitHub Actions and the base image.

## Testing

- `tests/unit`: one module at a time, no network.
- `tests/integration`: the real app on a random port, called over HTTP with `tests/helpers/server.js`.

CI (`.github/workflows/ci.yml`) runs lint and format checks, the tests on Node.js 22 and 24, and builds the Docker image and calls `/api/health` inside it.

## Xo, the assistant panel

`003_xo.sql` adds the tables behind the chat panel, again with a `workspace_id` on each:

- `xo_conversations` and `xo_messages`: a chat belongs to one person, so the history shows only their own chats. A chat closes after 40 messages.
- `xo_artifacts`, `xo_artifact_versions` and `xo_artifact_events`: the drafts Xo prepares, one row per version, and the history shown under a draft. Placeholders are not stored; they are read from the code (`FILL_IN_NAME`), so a draft is complete exactly when none are left.
- `xo_approvals`: a request names one version and the SHA-256 of its content. A decision must send the hash the person reviewed; if the draft changed since, or the request was already decided, nothing is written and the answer is `409 stale_approval`. Editing a draft marks its open requests stale and opens a new one.
- `xo_cards`: the scan and draft cards shown in a chat.

Replies are scripted (`src/server/services/xo/replies.js`): a message is matched to an intent by keyword and the reply is filled in from the workspace's own data, so no request leaves the server and every number is grounded. A turn is prepared in one transaction (`chat-service.js`) and returned as a list of events; the route (`routes/xo.js`) sends them as server-sent events with a pause between words. Drafts (`drafts.js`) are built from the client record and leave any fact the record does not hold as a placeholder. Only a workspace owner approves or rejects; anyone in the workspace can edit. Xaeo never changes a client's site: an approved draft is exported, and the person ships it.

## Fixes and workspace settings

`004_fixes_workspace.sql` adds the tables for fixes and the settings that belong to the workspace, each with a `workspace_id`:

- `fixes`: the ranked work for a client, with its status (`todo`, `done`, `wont`), the proposed change and how many missed answers it is expected to win back (`gain`). `fix_evidence` links a fix to the answers that justify it.
- A done fix counts as measured only by a scan that finished after `done_at`, so an earlier scan is never read as proof. The progress estimate is the latest scan's count plus the `gain` of every fix that is open, or done but not yet measured. It is an estimate and the web app labels it so.
- `fix_handoffs`: one row per export, with a SHA-256 of what the row said. A fix whose current fingerprint differs from its last handoff reads as changed since the last export (`services/fixes/fix-export.js`). `services/fixes/csv.js` writes RFC 4180 and puts an apostrophe before any cell a spreadsheet would run as a formula.
- Brand, logo and time zone are columns on `workspaces`. The logo is stored in the database and served with a policy that blocks scripts; its bytes are checked against the declared type and an SVG that carries script is refused (`services/workspace-service.js`). Owners change these; `requireOwner` in `http/session.js` is the guard.
- `clients.deletion_requested_at` and `deletion_execute_after` hold a pending client deletion. `services/lifecycle-service.js` deletes due clients at start-up and hourly, and the foreign keys remove everything under the client.
- Xaeo saves no website observations, so comparing them (`verify`) is refused for every fix and `canVerify` is always false.
