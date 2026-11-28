-- Saved reports (the white-label fix and progress reports an agency prints for a client) and the
-- invitations that bring a person into a workspace. Every table carries workspace_id so a query
-- can always be scoped to the signed-in user's workspace.

-- A report is saved the first time it is printed, after the person confirmed they reviewed it. It
-- points at the scan it was built from, so reopening it shows the same numbers even after a newer
-- scan; deleting the client or the scan deletes it too.
CREATE TABLE reports (
  id                INTEGER PRIMARY KEY,
  workspace_id      INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id         INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  scan_id           INTEGER NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('fix', 'progress')),
  -- The two options on the report toolbar: show the full answers, show the estimated gains.
  include_answers   INTEGER NOT NULL DEFAULT 0 CHECK (include_answers IN (0, 1)),
  include_estimates INTEGER NOT NULL DEFAULT 0 CHECK (include_estimates IN (0, 1)),
  -- Who confirmed the review; kept as NULL if that person later leaves.
  created_by        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX reports_client_id ON reports (client_id, created_at DESC);

-- An owner invites an email address into the workspace. Accepting is a later step; until then the
-- row only records the offer, and one address has at most one open offer per workspace.
CREATE TABLE invitations (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  invited_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, email)
) STRICT;
