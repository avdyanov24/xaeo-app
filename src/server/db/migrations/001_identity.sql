-- Identity: people, the agency workspaces they belong to, and their sign-in sessions.
-- Every later table that holds agency data carries a workspace_id so queries can be
-- scoped to the signed-in user's workspace.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- 'admin' can open the admin area; everyone else is 'user'.
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE workspaces (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE memberships (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
) STRICT;

CREATE INDEX memberships_user_id ON memberships (user_id);

-- The browser holds a random token; only its SHA-256 hash is stored, so a leaked
-- database cannot be used to sign in.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at   TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
