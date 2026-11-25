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

## Accounts and sessions

`001_identity.sql` adds `users`, `workspaces`, `memberships` (owner or member) and `sessions`. Signing up creates a user and a workspace they own. A user's `role` is `user` or `admin`.

`src/server/services/auth-service.js` signs users up and in, and resolves sessions. `src/server/http/session.js` reads and writes the `xaeo_session` cookie and provides route guards:

```js
router.get(
  '/api/app/me',
  sessionHttp.authenticated(({ session }) => session.user),
);
router.get(
  '/api/admin/users',
  sessionHttp.adminOnly(() => listUsers()),
);
```

A guarded handler receives `ctx.session` with `user` and `workspace`; services take `session.workspace.id` to scope their queries. The reasoning is in [ADR 0002](adr/0002-cookie-sessions-and-scrypt.md).

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
