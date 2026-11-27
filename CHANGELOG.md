# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Static file server for `src/web`: content types, ETag and conditional requests, `HEAD`, a no-cache policy for pages, and protection against path traversal, dotfiles and symlinks that leave the folder.
- Page routes: `/` redirects to `/app`, `/app` serves the agency web app, `/login` and `/signup` serve their pages when present.
- The agency web app shell: design tokens, self-hosted fonts, the app page, the hash router and the client, overview, answers, questions, fixes, approvals, engines, settings and reports views. The views fill in as the API routes behind them are added.
- Xo chat panel, action cards, command palette and guided tour scripts.
- The Xo morph renderer (`/assets/xo-morph-v1/xo-morph.js`) that `xo.js` loads, so Xo draws on the app and account pages instead of failing with a 404.
- HTTP server with a method and path router, JSON body parsing with size limits, input validation, a consistent JSON error envelope, request ids, security headers, structured logs and graceful shutdown.
- `GET /api/health` liveness endpoint.
- SQLite database through `node:sqlite`, with SQL migrations applied on start-up.
- Accounts: sign up, log in, log out and `GET /api/session`, with scrypt password hashing, cookie sessions stored as token hashes, `requireUser` and `requireAdmin` route guards, and a limit on failed logins per address and email.
- Login and signup pages, the account page and app stylesheets, and inline form errors.
- `GET /api/app/me`, and redirects that send signed-out visitors from `/app` to `/login` and back.
- `npm run db:seed` with the Brightline Digital workspace and a user and an admin test account, and `npm run db:reset`.
- `DATABASE_PATH` and `SESSION_TTL_DAYS` settings; the Docker image keeps the database on a volume.
- Unit and integration tests with the Node.js test runner.
- ESLint and Prettier configuration and `npm run check`. Loose `== null` comparisons are allowed for null-or-undefined checks; every other `==` is an error.
- CI on GitHub Actions: lint, format check, tests on Node.js 22 and 24, Docker image build and smoke test.
- Dockerfile and Compose service.
- Architecture guide, API reference, ADR 0001 and ADR 0002, contributing guide, code of conduct and security policy.
- Engine interface for ChatGPT and Claude, and a sample engine that reads the scripted Northside Plumbing answer set (5 buyer questions, 10 answers).
- Scan lifecycle as pure functions (queued, running, done, failed, cancelled, with retry) and answer progress counting.
- Xo, the assistant panel: `POST /api/app/xo/turn` streams a scripted reply as server-sent events, with chats, suggestions and usage routes. Replies come from a scripted reply set matched by keyword and filled in from the workspace's own numbers.
- Drafts Xo prepares from a client record (LocalBusiness JSON-LD and an llms.txt) with `FILL_IN_` placeholders for facts it cannot know, and the approvals queue: approve or reject by content hash (owners only), edit as a new version, export once, and download the file.
- Migration `003_xo.sql`: conversations, messages, drafts with versions and history, approvals and chat cards.
- `GET /api/app/me` returns `xo: true`, which switches on the Ask Xo panel and the Approvals page.
- Xo animation clips and poses (`assets/xo-app`, `assets/xo-morph-v1`), left out of Prettier because they are generated data.
- Answer extractor: finds the client and competitors with offsets, reads citations, reports position and the Cited, Mentioned or Not mentioned label.
- Clients, buyer questions, scans and answers: `002_clients_scans.sql`, the repositories behind it, and the Northside Plumbing sample client and its first scan in the seed.
- Routes for clients (list, create, edit, archive, the sample client), questions, scans (start, poll, cancel, retry), answers, `GET /api/app/engines` and `GET /api/app/stats`, all scoped to the signed-in workspace.
- In-process scan runner: a scan goes from queued to running to done over about three seconds, and one that was still running when the server stopped is marked failed on start-up so it can be retried.
- The first-run checklist state in `GET /api/app/me`.
- Fixes: the ranked list for a client with evidence, badges and a progress estimate, marking a fix done, set aside or reopened, and Northside Plumbing's four sample fixes (`GET /api/app/clients/:id/fixes`, `POST /api/app/fixes/:id/status`). Comparing saved website observations (`POST /api/app/fixes/:id/verify`) is owner-only and refuses every request, because no website observations are saved.
- CSV handoff for fixes: an RFC 4180 download that defuses spreadsheet formulas, and a record of which fixes were exported and which changed since.
- Agency brand, logo (PNG, JPEG or SVG up to 300 KB, checked by content) and workspace time zone, owner-only, shown in `GET /api/app/me`.
- `GET /api/app/export`: the workspace's brand, members, clients, questions, scans, answers and fixes as one JSON file, without passwords or session tokens.
- `GET /api/app/suggest`: starting buyer questions for a new client, from fixed templates.
- Client deletion: owners request it for an archived client, which is deleted seven days later unless cancelled or unarchived.
- `requireOwner` route guard.

### Fixed

- The clients list failed to draw ("We couldn't load your clients") because client rows had no `nextAction`. `GET /api/app/clients` rows now carry `history`, `delta` and `nextAction`.

## [0.1.0] - 2026-11-17

### Added

- Initial project setup.
