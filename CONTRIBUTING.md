# Contributing

## Workflow

1. Branch from `main` using `feature/<short-name>` or `fix/<short-name>`.
2. Make small, focused commits.
3. Open a pull request. CI must pass (`npm test`) before merging.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type: short description`, for example `feat: add scan history page` or `fix: handle empty engine response`. Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

## Code style

- File names are `kebab-case` (`scan-service.js`, `brand-form.js`).
- Keep files under about 300 lines. Split a file when it grows past that.
- ES modules only. No dependency unless the platform cannot do the job.
- Follow `.editorconfig` (2 spaces, LF line endings).

## Layer rule

- `routes/` handle HTTP only: parse, validate, call a service, respond.
- `services/` hold business logic and never touch HTTP (no request or response objects).
- `engines/` all implement the same interface so they can be swapped.
- `db/` holds the schema and repositories; nothing else writes SQL.
- `src/web/js/api.js` is the only frontend file that talks to the backend.

## Tests

Every feature ships with tests. Unit tests go in `tests/unit`, tests that exercise the HTTP API go in `tests/integration`. Tests must not call real AI engines or need API keys.

## Secrets

Never commit `.env` files, API keys or database files.
