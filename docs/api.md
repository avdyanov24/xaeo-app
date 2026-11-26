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
  },
  "onboarding": { "client": true, "questions": true, "brand": false, "report": false }
}
```

`onboarding` drives the first-run checklist on the clients list: `client` is true once the workspace has an active client, `questions` once an active client has a question switched on. `brand` and `report` stay `false` until branding and reports exist.

### `GET /api/app/clients` (signed in)

The workspace's clients, newest first. `?archived=1` lists archived clients instead. `archivedCount` is always the number of archived clients, so the app can show the link to them.

```json
{
  "clients": [
    {
      "id": 1,
      "name": "Northside Plumbing",
      "domain": "northsideplumbing.co.uk",
      "type": "Plumber",
      "city": "Leeds",
      "country": "GB",
      "sample": true,
      "status": "active",
      "weekly": true,
      "nextRunAt": "2026-12-03T10:00:00.000Z",
      "questions": 5,
      "runningId": null,
      "latest": {
        "id": 1,
        "number": 1,
        "finishedAt": "2026-11-26T10:00:00.000Z",
        "ok": 10,
        "mentioned": 2,
        "failed": 0
      }
    }
  ],
  "archivedCount": 0
}
```

`latest` is the newest finished scan, or `null`. `runningId` is the id of the scan in progress, or `null`.

### `POST /api/app/clients` (signed in)

Adds a client. Body: `name`, `domain` (a bare host or a pasted address, stored as a bare host), optional `type`, `city`, `country` (two letters), `questions` as `[{ "text", "intent" }]` with intent one of `find`, `compare`, `urgent`, `trust`, and `scan` (true to start the first scan now). The weekly rescan starts on, due in a week. Responds `201` with `{ "id" }`, plus `scanNote` when a scan was asked for but could not start (for example no questions); `422` with the list of invalid fields otherwise.

### `GET /api/app/clients/:id` (signed in)

One client in the shape above, with differences: `questions` is the list `[{ id, text, intent, active }]` in order (in the list it is a count), and it adds `scans` (every scan, newest first, with `ok`, `mentioned` and `failed` totals) and `running`, the scan in progress or `null`. `404` for a client in another workspace.

### `POST /api/app/clients/:id` (signed in)

Changes the fields sent: `name`, `domain`, `type`, `city`, `country`, and `weekly` (switches the weekly rescan on or off; ignored for an archived client). Responds with the client as `GET` returns it. `PATCH` does the same.

### `PATCH /api/app/clients/:id` (signed in)

Same as `POST /api/app/clients/:id`.

### `POST /api/app/clients/:id/archive` (signed in)

Hides the client from the list and turns its weekly rescan off. Responds `204`.

### `POST /api/app/clients/:id/unarchive` (signed in)

Brings an archived client back. The weekly rescan stays off until it is switched on again. Responds `204`.

### `POST /api/app/sample` (signed in)

Adds the Northside Plumbing example client with its five questions and a finished first scan (named in 2 of 10 answers). A workspace has one: calling this again returns its id with `200`. Responds `201` with `{ "id" }` when it was added.

### `GET /api/app/stats` (signed in)

The agency-wide numbers above the clients list, counted from each active client's latest finished scan. The sample client is left out, so with only the sample client `scanned` is `false` and the web app hides the block.

```json
{
  "scanned": true,
  "totals": { "ok": 10, "mentioned": 2, "cited": 1, "doneFixes": 0, "openFixes": 0 },
  "previous": null,
  "byEngine": [
    { "id": "chatgpt", "name": "ChatGPT", "ok": 5, "mentioned": 0 },
    { "id": "claude", "name": "Claude", "ok": 5, "mentioned": 2 }
  ],
  "weeks": [{ "start": "2026-11-23T00:00:00.000Z", "ok": 10, "mentioned": 2, "fixesDone": 0 }],
  "sampleExcluded": true,
  "weeklyAggregation": { "description": "..." },
  "nextRescan": "2026-12-03T10:00:00.000Z",
  "nextRescanCount": 1,
  "rescansPaused": false
}
```

`previous` is the same totals for the scan before each client's latest, and only when every client has one; otherwise `null`. `weeks` runs from the week of the first scan (at most the last 8 weeks, Monday starts, UTC) to the current week, each week adding up every client's latest scan to that point; it is a description, not a controlled comparison. `nextRescan` is the soonest weekly rescan and `nextRescanCount` how many clients fall on that day. `doneFixes`, `openFixes` and `fixesDone` stay `0` until fixes exist.

### `GET /api/app/engines` (signed in)

The engines scans ask, and where their answers come from. Xaeo asks ChatGPT and Claude only. Every engine is in the `sample` state because answers come from a scripted sample set, which the engines view shows as such.

```json
{
  "mode": "sample",
  "engines": [
    { "id": "chatgpt", "name": "ChatGPT", "provider": "OpenAI", "state": "sample" },
    { "id": "claude", "name": "Claude", "provider": "Anthropic", "state": "sample" }
  ]
}
```

### `GET /api/app/clients/:id/answers` (signed in)

The Answers tab's grid for one scan: the questions down the side, the engines across, one cell per answer. Without a query it is the newest finished scan; `?scan=<id>` opens an older one (a finished or cancelled scan of this client). `scans` lists the scans that can be opened, newest first, for the scan picker.

```json
{
  "scan": {
    "id": 1,
    "number": 1,
    "state": "done",
    "status": "done",
    "finishedAt": "2026-11-26T10:00:00.000Z",
    "ok": 10,
    "mentioned": 2,
    "failed": 0,
    "configuration": {
      "state": "recorded",
      "source": "sample",
      "snapshot": { "methodology": "..." }
    },
    "comparisonToPrevious": { "comparable": false, "reasons": [{ "message": "..." }] }
  },
  "scans": [
    {
      "id": 1,
      "number": 1,
      "state": "done",
      "finishedAt": "2026-11-26T10:00:00.000Z",
      "ok": 10,
      "mentioned": 2,
      "failed": 0
    }
  ],
  "questions": [{ "id": "1", "text": "Who is the best emergency plumber in Leeds?" }],
  "engines": [
    { "id": "chatgpt", "name": "ChatGPT" },
    { "id": "claude", "name": "Claude" }
  ],
  "cells": {
    "1": {
      "claude": { "id": "2", "status": "ok", "label": "Mentioned", "position": 2, "error": null }
    }
  }
}
```

`cells` is keyed by question id, then engine id. Ids inside `questions` and `cells` are strings. `label` is `Cited` (named, and the client's site is a source), `Mentioned`, `Not mentioned` or `Failed`. `comparisonToPrevious.comparable` is true when the previous finished scan asked the same questions; otherwise the scan starts a new baseline and `reasons` says why. A client with no finished scan gets `scan: null` and empty lists. `404` for an unknown client, an unknown or malformed `scan`, or anything in another workspace.

### `GET /api/app/answers/:id` (signed in)

One answer in full, for the reader that opens from a grid cell (`id` is the cell's `id`).

```json
{
  "id": "2",
  "scanId": 1,
  "engine": "Claude",
  "status": "ok",
  "label": "Mentioned",
  "position": 2,
  "question": "Who is the best emergency plumber in Leeds?",
  "clientName": "Northside Plumbing",
  "text": "...",
  "error": null,
  "competitors": ["Rapid Flow"],
  "citations": [{ "url": "https://...", "title": "...", "domain": "..." }],
  "mode": "sample",
  "method": "Read from the scripted sample answer set. No engine was asked.",
  "collectedAt": "2026-11-26T10:00:00.000Z"
}
```

`engine` is the display name. `position` is the client's place among the businesses named, or `null` when it is not named. A failed answer has `status: "failed"`, an `error` and no text. `404` for an unknown or malformed id, or an answer in another workspace.

### `GET /api/app/clients/:id/questions` (signed in)

The client's questions in order, without the deleted ones: `[{ "id", "text", "intent", "active" }]`.

### `POST /api/app/clients/:id/questions` (signed in)

Adds a question at the end. Body: `text` (3 to 200 characters) and optional `intent` (default `find`). A client has at most 50 questions (`409` beyond that). Responds `201` with the client as `GET /api/app/clients/:id` returns it.

### `POST /api/app/questions/:id` (signed in)

Changes `text`, `intent` or `active` (a switched-off question is skipped by scans). Responds with the client. Answers already collected keep the wording they were asked with. `PATCH` does the same.

### `PATCH /api/app/questions/:id` (signed in)

Same as `POST /api/app/questions/:id`.

### `POST /api/app/questions/:id/delete` (signed in)

Removes the question from the list; past answers keep it. Responds with the client. `DELETE /api/app/questions/:id` does the same.

### `DELETE /api/app/questions/:id` (signed in)

Same as `POST /api/app/questions/:id/delete`.

### `POST /api/app/clients/:id/scans` (signed in)

Starts a scan: every switched-on question asked of every engine, one answer at a time, in this process (no job queue). Responds `201` with the scan in state `queued`:

```json
{
  "id": 2,
  "clientId": 1,
  "number": 2,
  "state": "queued",
  "total": 10,
  "completed": 0,
  "error": null,
  "createdAt": "2026-11-26T10:00:00.000Z",
  "startedAt": null,
  "finishedAt": null,
  "ok": 0,
  "mentioned": 0,
  "failed": 0
}
```

States are `queued`, `running`, `done`, `failed` and `cancelled`. `409` when the client is archived or already has a scan in progress; `400` when no question is switched on.

### `GET /api/app/scans/:id` (signed in)

The scan in the shape above. The web app polls it while the scan runs: `completed` out of `total` is the progress, and `ok`, `mentioned` and `failed` count the answers stored so far.

### `POST /api/app/scans/:id/cancel` (signed in)

Stops a queued or running scan and keeps the answers already stored. `409` once it has finished.

### `POST /api/app/scans/:id/retry` (signed in)

Starts a failed or cancelled scan again from the first answer, replacing its stored answers. `409` when the scan cannot be retried or the client already has one in progress. A scan that was running when the server restarted is marked `failed` at start-up and can be retried.

## Xo, the assistant panel

Xo answers from a scripted reply set: a message is matched to an intent by keyword and the reply is filled in from the workspace's own numbers. No request leaves the server. A chat belongs to the person who started it; a draft belongs to the workspace.

### `POST /api/app/xo/turn` (signed in)

Sends one message and streams the reply as server-sent events (`text/event-stream`). Body: `{ "text": "...", "conversationId": 4, "uiState": { "clientId": "7" } }`. `text` is 1 to 4000 characters; leave out `conversationId` to start a chat; `uiState.clientId` says which client "this client" means, and otherwise the newest active client is used. The events, in order:

| Event     | Data                        | Meaning                                                    |
| --------- | --------------------------- | ---------------------------------------------------------- |
| `start`   | `{ conversationId }`        | The chat the message went to                               |
| `tool`    | `{ id, label, phase, ok? }` | A step Xo shows as it works; `phase` is `start` then `end` |
| `text`    | `{ delta }`                 | The next words of the reply                                |
| `card`    | `{ card }`                  | A scan or draft card to show under the reply               |
| `ui`      | `{ hash }`                  | A route the app should open, such as `#/clients/7/answers` |
| `refresh` | `{}`                        | Something changed that the open page should reload         |
| `done`    | `{ grounding, stopReason }` | The reply is complete                                      |

Errors before the stream starts are normal JSON errors: 422 for a bad body, 404 for a chat that is not yours, 409 `conversation_closed` once a chat holds 40 messages.

### `GET /api/app/xo/conversations` (signed in)

The signed-in person's chats, most recently active first: `{ conversations: [{ id, title, status, updatedAt }] }`. `status` is `open` or `closed`; times are milliseconds since the epoch.

### `GET /api/app/xo/conversations/:id` (signed in)

One chat for the panel to redraw: `{ conversation, messages, cards }`. A card carries the time it was made, so the panel can place it after the reply it belongs to. Another person's chat is a 404.

### `GET /api/app/xo/suggestions` (signed in)

The chips in the empty panel: `{ suggestions: [{ label, message } | { label, hash }] }`. A `message` chip sends that text; a `hash` chip opens that route. Optional query `clientId`.

### `GET /api/app/xo/usage` (signed in)

`{ blocked: null, rateLimit: null }`. Scripted replies have no allowance, so nothing is ever limited; the panel reads this to decide whether to close its composer.
