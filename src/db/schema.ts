// ============================================================
//  Schema SQLite (embedded come stringa per evitare path-issue ESM).
//  Tutti i timestamp sono epoch ms (INTEGER).
// ============================================================
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS controller_state (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  profile_url TEXT NOT NULL UNIQUE,
  public_id   TEXT,
  first_name  TEXT,
  last_name   TEXT,
  full_name   TEXT,
  headline    TEXT,
  company     TEXT,
  location    TEXT,
  email       TEXT,
  custom      TEXT,
  source      TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  steps      TEXT NOT NULL,
  settings   TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL,
  contact_id     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'enrolled',
  current_step   INTEGER NOT NULL DEFAULT 0,
  next_action_at INTEGER,
  connect_sent_at INTEGER,
  accepted_at    INTEGER,
  last_action_at INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE(campaign_id, contact_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id)  REFERENCES contacts(id)  ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS actions (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT,
  contact_id  TEXT,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      TEXT,
  screenshot  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  severity   INTEGER NOT NULL DEFAULT 1,
  detail     TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actions_type_status_created ON actions(type, status, created_at);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at);
CREATE INDEX IF NOT EXISTS idx_cc_campaign_status ON campaign_contacts(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_cc_next_action ON campaign_contacts(next_action_at);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
`;
