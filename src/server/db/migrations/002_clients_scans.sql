-- Clients an agency tracks, the buyer questions asked for them, and the scans that ask those
-- questions of each engine. Every table carries workspace_id so a query can always be scoped to
-- the signed-in user's workspace, even where the parent row would also give it.

CREATE TABLE clients (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- Bare host name without scheme or www, for example northsideplumbing.co.uk.
  domain       TEXT NOT NULL,
  -- Kind of business, free text such as "Plumber".
  type         TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  -- ISO 3166-1 alpha-2 code.
  country      TEXT NOT NULL DEFAULT 'GB',
  -- 1 for the example client that ships as sample data.
  sample       INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  -- Archived clients stay in the database and come back with unarchive.
  archived_at  TEXT,
  -- When the next weekly rescan is due; NULL means scheduled rescans are off.
  next_run_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX clients_workspace_id ON clients (workspace_id, archived_at);

CREATE TABLE questions (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  -- What the buyer is trying to do: find, compare, urgent or trust.
  intent       TEXT NOT NULL DEFAULT 'find' CHECK (intent IN ('find', 'compare', 'urgent', 'trust')),
  -- 0 pauses a question without deleting it; scans only ask active questions.
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- Deleted questions keep their rows so past answers still show the wording they were asked with.
  deleted_at   TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX questions_client_id ON questions (client_id, position);

CREATE TABLE scans (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  -- Counts up per client, so the app can say "Scan 3".
  number       INTEGER NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  total        INTEGER NOT NULL CHECK (total > 0),
  completed    INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at   TEXT,
  finished_at  TEXT,
  UNIQUE (client_id, number)
) STRICT;

CREATE INDEX scans_client_id ON scans (client_id, number);

-- One engine's answer to one question in one scan.
CREATE TABLE answers (
  id            INTEGER PRIMARY KEY,
  workspace_id  INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  scan_id       INTEGER NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions (id),
  -- The wording asked, copied so a later edit does not rewrite history.
  question_text TEXT NOT NULL,
  engine        TEXT NOT NULL CHECK (engine IN ('chatgpt', 'claude')),
  status        TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  text          TEXT,
  error         TEXT,
  mentioned     INTEGER NOT NULL DEFAULT 0 CHECK (mentioned IN (0, 1)),
  -- Place among the businesses named, starting at 1; NULL when the client is not named.
  position      INTEGER,
  label         TEXT,
  -- JSON arrays: the citations as { url, title, domain }, the client URLs among them, and the
  -- competitor names found in the text.
  citations     TEXT NOT NULL DEFAULT '[]',
  cited_urls    TEXT NOT NULL DEFAULT '[]',
  competitors   TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (scan_id, question_id, engine)
) STRICT;

CREATE INDEX answers_scan_id ON answers (scan_id);
CREATE INDEX answers_workspace_id ON answers (workspace_id);
