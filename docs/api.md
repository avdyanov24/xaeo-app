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
