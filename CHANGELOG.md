# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Static file server for `src/web`: content types, ETag and conditional requests, `HEAD`, a no-cache policy for pages, and protection against path traversal, dotfiles and symlinks that leave the folder.
- Page routes: `/` redirects to `/app`, `/app` serves the agency web app, `/login` and `/signup` serve their pages when present.
- The agency web app shell: design tokens, self-hosted fonts, the app page, the hash router and the client, overview, answers, questions, fixes, approvals, engines, settings and reports views. The views fill in as the API routes behind them are added.
- Xo chat panel, action cards, command palette and guided tour scripts.
- HTTP server with a method and path router, JSON body parsing with size limits, input validation, a consistent JSON error envelope, request ids, security headers, structured logs and graceful shutdown.
- `GET /api/health` liveness endpoint.
- Unit and integration tests with the Node.js test runner.
- ESLint and Prettier configuration and `npm run check`. Loose `== null` comparisons are allowed for null-or-undefined checks; every other `==` is an error.
- CI on GitHub Actions: lint, format check, tests on Node.js 22 and 24, Docker image build and smoke test.
- Dockerfile and Compose service.
- Architecture guide, API reference, ADR 0001, contributing guide, code of conduct and security policy.
- Engine interface for ChatGPT and Claude, and a sample engine that reads the scripted Northside Plumbing answer set (5 buyer questions, 10 answers).
- Scan lifecycle as pure functions (queued, running, done, failed, cancelled, with retry) and answer progress counting.
- Answer extractor: finds the client and competitors with offsets, reads citations, reports position and the Cited, Mentioned or Not mentioned label.

## [0.1.0] - 2026-11-17

### Added

- Initial project setup.
