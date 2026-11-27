-- Fixes (the ranked work that follows from missed answers), the handoffs that record when a fix
-- went into an export, the agency brand and time zone on the workspace, and the delay between
-- asking to delete a client and the deletion running. Every table carries workspace_id so a query
-- can always be scoped to the signed-in user's workspace.

CREATE TABLE fixes (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  -- Rank within the client, starting at 1; the list is read in this order.
  position     INTEGER NOT NULL,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('jsonld', 'page', 'listing', 'copy', 'crawler')),
  impact       TEXT NOT NULL CHECK (impact IN ('High', 'Medium', 'Low')),
  evidence     TEXT NOT NULL CHECK (evidence IN ('Strong', 'Medium', 'Weak')),
  -- The page the change is for, as a full URL.
  url          TEXT NOT NULL,
  -- JSON array of the engine ids whose answers the fix is aimed at.
  engines      TEXT NOT NULL DEFAULT '[]',
  why          TEXT NOT NULL,
  -- The proposed change, shown with a copy button; `lang` says how to read it.
  code         TEXT NOT NULL,
  lang         TEXT NOT NULL CHECK (lang IN ('jsonld', 'html', 'markdown', 'text')),
  verify       TEXT NOT NULL,
  -- How many currently missed answers the fix is expected to win back. An estimate, never a promise.
  gain         INTEGER NOT NULL DEFAULT 1 CHECK (gain >= 0),
  -- Set by a person: todo, done (the agency says it shipped) or wont (set aside, undoable).
  status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'wont')),
  done_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX fixes_client_id ON fixes (client_id, position);

-- The answers that show why a fix exists.
CREATE TABLE fix_evidence (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  fix_id       INTEGER NOT NULL REFERENCES fixes (id) ON DELETE CASCADE,
  answer_id    INTEGER NOT NULL REFERENCES answers (id) ON DELETE CASCADE,
  PRIMARY KEY (fix_id, answer_id)
) STRICT;

-- One row each time a fix leaves in an export. `content_hash` fingerprints what the file said, so
-- a later edit shows as "changed since the last export".
CREATE TABLE fix_handoffs (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  fix_id       INTEGER NOT NULL REFERENCES fixes (id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('csv')),
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX fix_handoffs_fix_id ON fix_handoffs (fix_id, id);

-- The agency brand shown on reports, and the zone the weekly rescans are scheduled in.
ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT '#1F3BFF';
ALTER TABLE workspaces ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN contact TEXT NOT NULL DEFAULT '';
-- The logo file itself (PNG, JPEG or SVG, up to 300 KB), with the media type it was uploaded as.
ALTER TABLE workspaces ADD COLUMN logo BLOB;
ALTER TABLE workspaces ADD COLUMN logo_type TEXT;
ALTER TABLE workspaces ADD COLUMN logo_updated_at TEXT;
ALTER TABLE workspaces ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/London';

-- Deleting a client waits for a grace period. Both stay NULL until an owner asks.
ALTER TABLE clients ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE clients ADD COLUMN deletion_execute_after TEXT;
