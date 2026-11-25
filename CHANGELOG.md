# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- HTTP server with a method and path router, JSON body parsing with size limits, input validation, a consistent JSON error envelope, request ids, security headers, structured logs and graceful shutdown.
- `GET /api/health` liveness endpoint.
- SQLite database through `node:sqlite`, with SQL migrations applied on start-up.
- Accounts: sign up, log in, log out and `GET /api/auth/session`, with scrypt password hashing, cookie sessions stored as token hashes, and `authenticated` and `adminOnly` route guards.
- `DATABASE_PATH` and `SESSION_TTL_DAYS` settings; the Docker image keeps the database on a volume.
- Unit and integration tests with the Node.js test runner.
- ESLint and Prettier configuration and `npm run check`.
- CI on GitHub Actions: lint, format check, tests on Node.js 22 and 24, Docker image build and smoke test.
- Dockerfile and Compose service.
- Architecture guide, API reference, ADR 0001 and ADR 0002, contributing guide, code of conduct and security policy.

## [0.1.0] - 2026-11-17

### Added

- Initial project setup.
