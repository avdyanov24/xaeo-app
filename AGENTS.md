# AGENTS.md

The first file any AI agent working on this repository reads. It covers what the project is for, the competition it is submitted to, how the work is planned, and the rules every change follows. Keep it accurate: when the code, the plan or the rules change, update this file in the same pull request.

## What this repository is

Xaeo shows marketing agencies how their clients appear in AI answers (ChatGPT and Claude), and helps them fix it. This repository holds Xaeo's real web UI together with a Node.js backend that serves seeded sample data from SQLite. The live defence presents the full Xaeo product; this repo is the submitted source code. The defence deck is a separate static site: https://defence-deck-3epv.vercel.app

## The competition

- Event: НЕТИТ 2026, the Bulgarian national IT competition.
- Category: "Разпределени приложения" (distributed applications).
- Team "Xaeo": Alexander Dyanov and Velin Markov, grade 10.
- Theme: "Agentic AI Search Visibility SaaS for SEO Agencies".
- Registration by 29 November 2026. Defence in Sofia, 4 to 6 December 2026, 15 minutes including the jury Q&A. Results by 7 December.

### Rules that matter for this repo

- Submitting the source code is mandatory for admission to the defence, and the jury reviews uploads in advance. Write everything in this repo as if the jury reads it, because it does.
- The declaration releases the work under the GNU GPL. The repo is GPL-3.0 (see `LICENSE`).
- Web apps must be online during judging, with test accounts for every role (user and admin). Keep the seeded accounts working and documented in the README "Test accounts" section.
- Company advertising is grounds for disqualification. No promotional copy, pricing, sales claims or calls to action in the repo, the docs or the app.

### Scoring (100 points)

| Criterion                                                                                                                             | Points |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Idea and originality                                                                                                                  | 20     |
| Design and architecture, including separating the UI from business logic                                                              | 25     |
| Implementation: naming, readability, comments, performance, error handling, plus version control and automated tests in this category | 35     |
| Presentation and defence                                                                                                              | 20     |

What this means for changes: keep the UI (`src/web`) and the business logic (`src/server/services`) strictly apart, name things clearly, comment the why, handle errors through the shared helpers, keep a readable git history, and ship tests with every feature.

## Build plan

The app is built in ten milestones, one per day, from 24 November to 3 December 2026, ahead of the 4 December defence. Each milestone is one branch and one pull request, and owners alternate: A is Alexander, V is Velin. A daily run builds the next due milestone, so a milestone's branch name matters: runs detect finished milestones by merged pull requests from these exact branches.

| Milestone | Date   | Owner | Branch                         | Scope                                                                                                                                        |
| --------- | ------ | ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | 24 Nov | A     | `chore/repo-foundation`        | Tooling, server skeleton, CI, Docker, docs, ADR 0001, community files (merged)                                                               |
| M1        | 25 Nov | V     | `feat/database-and-auth`       | SQLite with migrations, identity tables, scrypt passwords, cookie sessions, signup, login, logout, session, route guards                     |
| M2        | 25 Nov | A     | `feat/web-app-shell`           | Static file server, page routes, the app shell and its scripts and assets (session check and `GET /api/app/me` arrive with M3)               |
| M3        | 27 Nov | V     | `feat/auth-pages-and-styles`   | Login and signup pages, seed data and `npm run db:seed`, test accounts                                                                       |
| M4a       | 25 Nov | A     | `feat/engines-and-scan-model`  | Engine interface, the sample engine, the scan state machine and the answer extractor as pure services with unit tests, no database or routes |
| M4        | 28 Nov | A     | `feat/clients-and-scans`       | Clients, questions, scans, answers, engines, an in-process sample engine, the Northside Plumbing story                                       |
| M5        | 29 Nov | V     | `feat/xo-assistant`            | Xo assistant: streamed scripted replies, conversations, approvals, artifacts                                                                 |
| M6        | 30 Nov | V     | `feat/fixes-and-workspace`     | Fixes with status and verify, CSV export, brand and timezone settings, workspace export, client lifecycle                                    |
| M7        | 1 Dec  | V     | `feat/reports-and-account`     | White-label reports, account security, team and invitations with role checks                                                                 |
| M8        | 2 Dec  | A     | `feat/admin-and-screenshots`   | Admin area, screenshot script, README gallery, user guide                                                                                    |
| M9        | 3 Dec  | A     | `docs/walkthrough-and-release` | Walkthrough GIF and MP4, final README pass, version 1.0.0, tag and release                                                                   |

Dependencies: M1 needs M0, M2 needs M0, M3 needs M1 and M2, M4a needs M0, M4 needs M1 and M4a, M5 needs M4, M6 needs M4, M7 needs M6, M8 needs M7, M9 needs M8. Each milestone has a "done" check (for example, logging in as the seeded user lands on a styled `/app`, or `npm run check` is green); a milestone is finished only when that check passes by hand, CI is green and the pull request is merged.

### Workflow for every change

1. Branch from an up-to-date `main` (`feat/`, `fix/`, `docs/`, `chore/` prefix; milestone branches use the exact names above).
2. Make 2 to 6 small conventional commits that each leave the project working.
3. Run `npm run check` before every commit and before pushing.
4. Push the branch and open a pull request with `gh pr create`, saying what changed, why, and how it was tested.
5. Wait for CI to be green, then merge with a merge commit (`gh pr merge --merge --delete-branch`). Never squash, never rebase-merge, never push to `main` directly, never force-push.
6. Leave Dependabot pull requests alone; do not merge them.

## Rules for agents

- Commits: conventional commits, `type(scope): summary`, imperative and lower case, with a body when the reason is not obvious. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`. Use plain `git commit` with the repo-local git identity; no `--author`, no `Co-authored-by`, no agent attribution anywhere.
- One pull request per milestone or logical change.
- Layering on the server: `routes/` handle HTTP only (read params and body, validate with `lib/validate.js`, call a service); `services/` hold business logic and never touch `req` or `res`; `repositories/` are the only place that runs SQL, always with bound parameters. Scope every query by workspace so a user never reads another workspace's rows. Throw the helpers from `lib/errors.js`; never write error responses by hand.
- Every feature ships with tests: `tests/unit` for logic, `tests/integration` for HTTP (use `tests/helpers/server.js`). Tests need no network access and no API keys.
- `npm run check` (lint, format check, tests) must pass before any commit and before a pull request is opened.
- Documentation moves with the code: new or changed routes go in `docs/api.md`, notable user-facing changes in the `Unreleased` section of `CHANGELOG.md`, real design decisions in `docs/adr/`.
- Migrations are plain SQL files named `src/server/db/migrations/NNN_name.sql`, with the numbers fixed by the plan so parallel work never collides.
- Prefer the Node.js standard library. A new dependency needs a reason in the pull request.
- Sample data and docs name only ChatGPT and Claude as engines. Never mention Gemini or AI Overviews. Do not invent customers, statistics or prices.
- The example client is Northside Plumbing (Leeds, northsideplumbing.co.uk) and the example agency is Brightline Digital. The Northside story: 5 buyer questions across 2 engines make 10 answers; the baseline is 2 of 10; 4 fixes of which 1 is already shipped; all done is 6 of 10, shown as an estimate; the weekly chart is labelled "Illustrative example".
- Data that ships with the app is called "sample data" or "seed data"; Xo's replies come from a "scripted reply set".
- Never commit secrets, `.env` files, keys, tokens or database files. Check `git status` before committing.

## Repository layout

```
.github/            CI workflow, Dependabot, CODEOWNERS, issue and PR templates
docs/
  adr/              architecture decision records
  api.md            HTTP API reference
  architecture.md   how the pieces fit together
  media/            logos, and later screenshots and the walkthrough
src/
  server/
    index.js        process entry: reads config, starts the server
    app.js          builds the request handler
    config.js       environment configuration
    http/           router, body parsing, response helpers, static files
    lib/            errors, logger, input validation
    db/             SQLite connection, migrations and seed steps
    routes/         HTTP handlers (health, pages, accounts, clients, questions, scans, answers, engines)
    services/       business logic; services/engines for the engine interface, services/scans for the scan runner and state machine
    repositories/   SQL only
  web/              the browser UI, served as static files
tests/
  helpers/server.js starts the app for integration tests
  integration/      tests that call the HTTP API
  unit/             tests for individual modules
Dockerfile, compose.yaml    container build and local run
```

Later milestones add Xo, fixes, reports and the admin area, so some folders hold only a README until then. Read the tree rather than trusting this list when in doubt.

## Commands

Requires Node.js 22.13 or newer (`.nvmrc` pins the development version).

| Command                 | What it does                                         |
| ----------------------- | ---------------------------------------------------- |
| `npm ci`                | Install dependencies from the lockfile               |
| `cp .env.example .env`  | Create local configuration (never commit `.env`)     |
| `npm run dev`           | Start the server with file watching                  |
| `npm start`             | Start the server                                     |
| `npm test`              | Run all tests with the Node.js test runner           |
| `npm run test:coverage` | Run tests with coverage                              |
| `npm run lint`          | ESLint                                               |
| `npm run lint:fix`      | ESLint with automatic fixes                          |
| `npm run format`        | Prettier, write                                      |
| `npm run format:check`  | Prettier, check only                                 |
| `npm run check`         | Lint, format check and tests: the same steps CI runs |

Later milestones add `npm run db:seed`, `npm run db:reset`, `npm run docs:screenshots` and `npm run docs:walkthrough`. CI (`.github/workflows/ci.yml`) runs lint and format, tests on Node 22 and 24, and a Docker build with a `/api/health` smoke test.

## Where to read more

[README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [docs/architecture.md](docs/architecture.md), [docs/api.md](docs/api.md), [docs/adr/](docs/adr/README.md).
