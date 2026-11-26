-- Xo, the assistant panel: conversations and their messages, the drafts Xo prepares (artifacts) and
-- the approvals a person gives them, and the cards shown in the chat. Every table carries
-- workspace_id so each query can be scoped to the signed-in user's workspace.

CREATE TABLE xo_conversations (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The first question, shortened; shown in the chat history.
  title        TEXT NOT NULL DEFAULT '',
  -- A closed chat is read-only, for example once it reaches the message limit.
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- A person sees only their own chats, newest first.
CREATE INDEX xo_conversations_user ON xo_conversations (workspace_id, user_id, updated_at);

CREATE TABLE xo_messages (
  id              INTEGER PRIMARY KEY,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES xo_conversations (id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX xo_messages_conversation ON xo_messages (conversation_id, id);

-- A draft Xo prepared for a client: structured data, an llms.txt file, a page draft. Nothing ships
-- until a person approves it, and even then it is only exported; Xaeo never changes the client's site.
CREATE TABLE xo_artifacts (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('fix', 'jsonld', 'llms_txt', 'page', 'outreach')),
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  -- Page the draft is for, as a full URL; empty when it is not tied to one page.
  target_url   TEXT NOT NULL DEFAULT '',
  lang         TEXT NOT NULL DEFAULT 'text' CHECK (lang IN ('html', 'json', 'markdown', 'text')),
  risk         TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  -- The current version's content. Values Xo could not ground are written FILL_IN_NAME and filled by a person.
  code         TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  state        TEXT NOT NULL DEFAULT 'pending'
               CHECK (state IN ('draft', 'pending', 'approved', 'applied', 'rejected')),
  -- JSON arrays of strings.
  notes        TEXT NOT NULL DEFAULT '[]',
  claims       TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX xo_artifacts_workspace ON xo_artifacts (workspace_id, client_id);

-- Every edit makes a new version; an approval belongs to exactly one version.
CREATE TABLE xo_artifact_versions (
  artifact_id  INTEGER NOT NULL REFERENCES xo_artifacts (id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  code         TEXT NOT NULL,
  -- SHA-256 of the code, hex. An approval names the hash it reviewed.
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (artifact_id, version)
) STRICT;

CREATE TABLE xo_approvals (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  artifact_id  INTEGER NOT NULL REFERENCES xo_artifacts (id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  -- 'stale' means the draft was edited after the request; the new version has its own request.
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'stale')),
  decided_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  decided_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX xo_approvals_workspace ON xo_approvals (workspace_id, status);
CREATE INDEX xo_approvals_artifact ON xo_approvals (artifact_id, version);

-- The history shown under a draft: who drafted, edited, approved or exported which version.
CREATE TABLE xo_artifact_events (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  artifact_id  INTEGER NOT NULL REFERENCES xo_artifacts (id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  version      INTEGER,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('xo', 'user', 'system')),
  actor_name   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX xo_artifact_events_artifact ON xo_artifact_events (artifact_id, id);

-- A card Xo put in a chat: a scan to start, or a draft to review.
CREATE TABLE xo_cards (
  id              INTEGER PRIMARY KEY,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES xo_conversations (id) ON DELETE CASCADE,
  client_id       INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('scan', 'artifact')),
  artifact_id     INTEGER REFERENCES xo_artifacts (id) ON DELETE CASCADE,
  -- Scan cards: open, done or dismissed. Artifact cards take their state from the artifact.
  state           TEXT NOT NULL DEFAULT 'open',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX xo_cards_conversation ON xo_cards (conversation_id, id);
