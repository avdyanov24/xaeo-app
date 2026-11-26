# HTTP API reference

All endpoints live under `/api` and speak JSON.

## Conventions

- **Requests:** bodies are JSON with `Content-Type: application/json`, up to 100 KB. An empty body is read as `{}`.
- **Responses:** JSON, `Cache-Control: no-store`. Every response carries an `X-Request-Id` header; quote it when reporting a problem.
- **Errors:** every error uses the same envelope:

  ```json
  { "error": { "code": "not_found", "message": "Not found." } }
  ```

  | Status | `code`                   | When                                               |
  | ------ | ------------------------ | -------------------------------------------------- |
  | 400    | `bad_request`            | The body is not valid JSON                         |
  | 401    | `unauthorized`           | No valid session, or wrong email or password       |
  | 403    | `forbidden`              | Signed in, but the role does not allow this        |
  | 404    | `not_found`              | No such endpoint or resource                       |
  | 409    | `conflict`               | The resource already exists                        |
  | 405    | `method_not_allowed`     | The path exists for other methods (see `Allow`)    |
  | 413    | `payload_too_large`      | The body is over the size limit                    |
  | 429    | `too_many_requests`      | Too many failed sign-ins; see `Retry-After`        |
  | 415    | `unsupported_media_type` | A body was sent without `application/json`         |
  | 422    | `validation_failed`      | Input failed validation; `issues` lists each field |
  | 500    | `internal_error`         | Unexpected server error                            |

## Endpoints

### `GET /api/health`

Liveness check, used by the Docker health check and CI.

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ "status": "ok", "version": "0.1.0", "uptimeSeconds": 42 }
```

## Pages and static files

These routes return HTML and files rather than JSON. Errors on them still use the JSON error envelope.

### `GET /`

Redirects (`302`) to `/app` when signed in, otherwise to `/login`. Redirects are `Cache-Control: no-store`.

### `GET /app`

The agency web app: serves `src/web/app.html` to a signed-in user. The page is `Cache-Control: no-cache`, so a new version shows on the next navigation. Without a session it redirects to `/login?next=%2Fapp`, and the login page returns there afterwards.

### `GET /login`, `GET /signup`

Serve `login.html` and `signup.html` from `src/web`. A signed-in user is redirected to `/app` instead.

### `GET /<path>` for files in `src/web`

Any other `GET` or `HEAD` request outside `/api` is looked up in `src/web`, so `/ui/js/main.js`, `/ds/tokens/colors.css` and `/assets/wordmark-48.webp` are the files at the same path in that folder.

| Behaviour    | Detail                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content type | From the file extension (`html`, `css`, `js`, `json`, `svg`, `png`, `webp`, `woff2`, ...).                                                                                                                          |
| Caching      | `.html` is `no-cache`; every other file is `public, max-age=300`.                                                                                                                                                   |
| Validators   | A weak `ETag` and `Last-Modified`. A matching `If-None-Match` returns `304`.                                                                                                                                        |
| `HEAD`       | Same headers, no body.                                                                                                                                                                                              |
| Not served   | Directories, dotfiles (any path segment starting with `.`), and anything that resolves outside `src/web`, including through encoded `..`, encoded slashes, backslashes, NUL bytes and symlinks. These return `404`. |

Other methods on a file path return `404`, and on a page route `405` with `Allow: GET`.

## Authentication

Signing up or in sets an `xaeo_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production). Browsers send it automatically; endpoints marked **signed in** return 401 without it.

The session body returned by these endpoints:

```json
{
  "user": { "id": 1, "email": "alex@brightline.example", "name": "Alex Morgan", "role": "user" },
  "workspace": { "id": 1, "name": "Brightline Digital", "role": "owner" }
}
```

`user.role` is `user` or `admin`; `workspace.role` is `owner` or `member`.

### `POST /api/signup`

Creates an account and a workspace the new user owns, and signs them in.

| Field           | Rules                       |
| --------------- | --------------------------- |
| `name`          | 1 to 100 characters         |
| `email`         | email address, unique       |
| `password`      | 10 to 200 characters        |
| `workspaceName` | the agency's name, 1 to 100 |

`201` with the session body and the cookie. `409 conflict` if the email is taken, `422` for invalid fields.

### `POST /api/login`

Body: `{ "email", "password" }`. `200` with the session body and a new cookie; any session the browser already had is ended. `401 unauthorized` with "Email or password is incorrect." for any wrong combination. After 5 failed attempts for the same email from the same address within 15 minutes, `429 too_many_requests` with a `Retry-After` header (seconds); a successful login clears the count.

### `POST /api/logout`

Ends the current session and clears the cookie. `204`, also when there was no session.

### `GET /api/session` (signed in)

`200` with the session body for the cookie sent.

## App

### `GET /api/app/me` (signed in)

Everything the web app needs to start: the user with their role in the workspace, the workspace, and the engines. Answers come from the sample engine, so `engineStatus.mode` is `sample`.

```json
{
  "user": {
    "id": 1,
    "email": "alex@brightline.example",
    "name": "Alex Morgan",
    "role": "user",
    "workspaceRole": "owner"
  },
  "workspace": { "id": 1, "name": "Brightline Digital", "timezone": "Europe/London" },
  "engines": [
    { "id": "chatgpt", "name": "ChatGPT" },
    { "id": "claude", "name": "Claude" }
  ],
  "engineStatus": {
    "mode": "sample",
    "engines": [
      { "id": "chatgpt", "name": "ChatGPT", "state": "sample" },
      { "id": "claude", "name": "Claude", "state": "sample" }
    ]
  }
}
```
