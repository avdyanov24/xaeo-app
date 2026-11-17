# src/server

Layer rule: `routes/` handle HTTP only; `services/` hold business logic and never touch HTTP; `engines/` share one interface; `db/` holds the schema and repositories; `lib/` has small shared helpers. See [docs/architecture.md](../../docs/architecture.md).
