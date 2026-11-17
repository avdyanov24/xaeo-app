# Xaeo

Xaeo is a web app that shows a brand how visible it is in AI answer engines such as ChatGPT and Perplexity. When people ask an AI assistant "what is the best tool for X?", some brands get mentioned and linked, and others do not. Xaeo measures that and tells you what to do about it.

> **Status: in development.** Everything below describes the planned scope. The repository currently contains the project scaffold and documentation only.

## Features (planned)

- **Accounts and roles:** sign up and log in as a `user`, or as an `admin` with access to all accounts and system settings.
- **Brands:** add a brand with its name and domain.
- **Scans:** a scan sends a set of buyer-style questions (for example "what is the best CRM for a small agency?") to one or more AI engines.
- **Detection:** for every answer, check whether the brand is mentioned and whether its domain is cited as a source.
- **Visibility score:** a single score per scan, with a per-engine and per-question breakdown.
- **Scan history:** keep past scans and compare how the score changes over time.
- **Recommendations:** practical, prioritised suggestions for improving visibility.
- **Engines:** OpenAI and Perplexity, plus a built-in mock engine so the whole app runs without any API keys.

## Architecture

```
  Browser (vanilla HTML/CSS/JS)
  src/web/js/api.js            <- the only frontend file that talks to the backend
        |
        |  HTTP / JSON
        v
  routes/       HTTP only: parse input, validate, call a service, send the response
        |
        v
  services/     business logic: scans, scoring, detection, recommendations
        |                 |
        v                 v
  engines/              db/
  one shared interface  schema + repositories (SQLite)
  - mock
  - openai
  - perplexity
```

Layer rule: routes handle HTTP only, services hold business logic and never touch HTTP, engines all implement one interface, `db` holds the schema and repositories, and `src/web/js/api.js` is the only frontend file that talks to the backend. More detail in [docs/architecture.md](docs/architecture.md).

## Folder structure

```
.
├── .github/workflows/ci.yml   CI: runs the tests on push and pull request
├── docs/                      architecture notes and user guide
├── scripts/                   helper scripts (database setup, seeding)
├── src/
│   ├── server/
│   │   ├── routes/            HTTP handlers
│   │   ├── services/          business logic
│   │   ├── engines/           AI engine adapters (mock, OpenAI, Perplexity)
│   │   ├── db/                schema and repositories
│   │   └── lib/               small shared helpers
│   └── web/
│       ├── pages/             HTML pages
│       ├── components/        reusable UI pieces
│       ├── styles/            CSS
│       └── js/                frontend scripts (api.js is the backend gateway)
├── tests/
│   ├── unit/                  tests for services, engines and helpers
│   └── integration/           tests that exercise the HTTP API
├── .env.example               environment variable template
├── CONTRIBUTING.md
├── LICENSE
└── package.json
```

## Tech stack

- Node.js 22, ES modules, no framework and no build step
- Vanilla HTML, CSS and JavaScript on the frontend
- SQLite for storage
- `node --test` for tests

## Getting started

Requirements: Node.js 22 or newer (`nvm use` reads the version from `.nvmrc`).

```sh
git clone https://github.com/avdyanov24/xaeo-app.git
cd xaeo-app
cp .env.example .env     # then set SESSION_SECRET
npm start
```

The app runs with `ENGINE_MODE=mock` by default, so no API keys are needed. The server entry point (`src/server/index.js`) is not written yet.

## Scripts

| Command       | What it does                                  |
| ------------- | --------------------------------------------- |
| `npm start`   | Start the server                              |
| `npm run dev` | Start the server and restart on file changes  |
| `npm test`    | Run all tests with the Node.js test runner    |

## Environment variables

Copy `.env.example` to `.env`. The `.env` file is ignored by git.

| Variable             | Default             | Description                                              |
| -------------------- | ------------------- | -------------------------------------------------------- |
| `PORT`               | `3000`              | Port the server listens on                               |
| `NODE_ENV`           | `development`       | `development`, `test` or `production`                    |
| `DATABASE_PATH`      | `./data/xaeo.db`    | Location of the database file                            |
| `ENGINE_MODE`        | `mock`              | `mock` uses the built-in engine; `live` uses real engines |
| `OPENAI_API_KEY`     | empty               | Needed only for the OpenAI engine                        |
| `PERPLEXITY_API_KEY` | empty               | Needed only for the Perplexity engine                    |
| `SESSION_SECRET`     | empty               | Long random string used to sign session cookies          |

## Testing

```sh
npm test
```

Tests use the built-in `node --test` runner and live in `tests/unit` and `tests/integration`. Test files are named `*.test.js`. Tests never call real AI engines; they use the mock engine.

## Test accounts

_To be added once the seed script exists: one `user` account and one `admin` account with their credentials._

## Authors

The Xaeo team:

- TODO: name
- TODO: name

## License

Copyright (C) 2026 The Xaeo team.

Released under the GNU General Public License v3.0 only. See [LICENSE](LICENSE).
