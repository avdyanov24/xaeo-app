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
  | 404    | `not_found`              | No such endpoint or resource                       |
  | 405    | `method_not_allowed`     | The path exists for other methods (see `Allow`)    |
  | 413    | `payload_too_large`      | The body is over the size limit                    |
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

Redirects (`302`) to `/app`. The response is `Cache-Control: no-store`.

### `GET /app`

The agency web app: serves `src/web/app.html`. The page is `Cache-Control: no-cache`, so a new version shows on the next navigation.

### `GET /login`, `GET /signup`

Serve `login.html` and `signup.html` from `src/web` when those pages exist, and `404` otherwise.

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
