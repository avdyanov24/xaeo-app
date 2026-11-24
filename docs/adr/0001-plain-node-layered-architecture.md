# 0001. Plain Node.js with a layered server

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Xaeo's server is a JSON API for one web app. A small team maintains it, and it must be easy to read, test and run: a new contributor should be productive after `npm ci`. The web app is plain HTML, CSS and JavaScript with no bundler, so the server does not need a build step either.

Node.js now ships what used to need packages: an HTTP server, a test runner (`node:test`), `.env` loading (`--env-file`), file watching (`--watch`) and an embedded SQLite driver (`node:sqlite`, unflagged since 22.13).

## Decision

- Use `node:http` with a small in-house router instead of a web framework. Runtime dependencies stay at zero; development tooling (ESLint, Prettier) is the only install.
- Organise the server in layers with one-way dependencies: `http` -> `routes` -> `services` -> `repositories`, plus a shared `lib`. Routes deal with HTTP, services with business rules, repositories with SQL.
- Store data in SQLite through `node:sqlite`, one file per deployment.
- Report every error through one JSON envelope with a stable `code`.
- Support Node.js 22.13 and newer; develop on Node.js 24.

## Consequences

- No framework upgrades to chase and nothing to compile; the code that runs is the code in the repository.
- We own the router, body parsing and error handling. They are small and covered by unit tests, but features a framework would give for free (for example cookie parsing) are written when needed.
- Layers keep business rules testable without HTTP, and SQL in one place.
- SQLite keeps local setup to zero steps. If the app needs several server instances writing at once, a move to a client-server database is a new ADR; repositories are the only code that would change.
