# Architecture

Xaeo is a single Node.js process that serves a JSON API under `/api`. It uses ES modules, has no framework and no build step. The reasons are recorded in [ADR 0001](adr/0001-plain-node-layered-architecture.md).

## Request lifecycle

1. `src/server/index.js` loads configuration, creates the logger and starts `node:http`.
2. `src/server/app.js` handles every request: it assigns an `X-Request-Id`, sets security headers and asks the router for a handler.
3. `src/server/http/router.js` matches the method and path (`/api/clients/:id` style patterns). An unknown path is a 404; a known path with the wrong method is a 405 with an `Allow` header.
4. The route handler validates its input and calls a service.
5. The handler's return value is sent as JSON with `Cache-Control: no-store`. Returning `{ status, body }` sets the status; returning nothing sends 204.
6. Any thrown `HttpError` becomes the JSON error envelope. Anything else is logged with its stack and the request id, and the client gets a generic 500.
7. One structured log line is written per request with the method, path, status and duration.

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
- Unexpected errors return a generic message; stacks stay in the server log.
- The Docker image runs as the non-root `node` user.
- Dependabot watches npm packages, GitHub Actions and the base image.

## Testing

- `tests/unit`: one module at a time, no network.
- `tests/integration`: the real app on a random port, called over HTTP with `tests/helpers/server.js`.

CI (`.github/workflows/ci.yml`) runs lint and format checks, the tests on Node.js 22 and 24, and builds the Docker image and calls `/api/health` inside it.
