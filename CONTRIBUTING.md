# Contributing to Xaeo

Thanks for helping. This guide covers how changes move from a branch to `main`.

## Setup

```sh
npm ci
cp .env.example .env
npm run dev
```

Use Node.js 24 for development (`nvm use`); CI also tests Node.js 22.

## Workflow

1. Branch from an up-to-date `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>` or `chore/<short-name>`.
2. Make small commits that each leave the project working.
3. Run `npm run check` before pushing. It runs the same lint, format and test steps as CI.
4. Open a pull request and fill in the template. CI must be green before merging.
5. Pull requests are merged with a merge commit so the individual commits stay in history. Delete the branch after merging.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, in the imperative and lower case, for example `feat(server): add client archive endpoint` or `fix(web): keep the filter after a reload`. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`. Explain the reason in the body when it is not obvious from the summary.

## Code style

- ESLint and Prettier settings are in the repository; `npm run lint:fix` and `npm run format` apply them.
- File names are `kebab-case`. Modules are ES modules.
- Prefer the Node.js standard library. A new dependency needs a reason in the pull request.

## Server layers

- `routes/` handle HTTP only: read params and body, validate with `lib/validate.js`, call a service, return the result.
- `services/` hold business logic and never touch `req` or `res`.
- `repositories/` are the only place that runs SQL, always with bound parameters.
- Throw `HttpError` helpers from `lib/errors.js`; never send error responses by hand.

See [docs/architecture.md](docs/architecture.md) for the full picture.

## Tests

Every change in behaviour ships with tests. Unit tests go in `tests/unit`; tests that call the HTTP API go in `tests/integration` and use `tests/helpers/server.js`. Tests never need network access or API keys.

## Documentation

- New or changed endpoints: update [docs/api.md](docs/api.md) in the same pull request.
- Significant design decisions: add an ADR in [docs/adr](docs/adr/README.md).
- User-facing changes: add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).

## Secrets

Never commit `.env` files, keys, tokens or database files. `.gitignore` covers the common cases; check `git status` before committing.
