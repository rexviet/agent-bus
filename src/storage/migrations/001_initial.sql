CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  approval_status TEXT NOT NULL,
  producer_agent_id TEXT NOT NULL,
  producer_runtime TEXT NOT NULL,
  producer_model TEXT,
  payload_json TEXT NOT NULL,
  payload_metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_topic ON events(topic);
CREATE INDEX IF NOT EXISTS idx_events_approval_status ON events(approval_status);

CREATE TABLE IF NOT EXISTS event_artifacts (
  event_id TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT,
  description TEXT,
  media_type TEXT,
  PRIMARY KEY (event_id, path),
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  available_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deliveries_status_available_at
  ON deliveries(status, available_at);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  feedback TEXT,
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approvals_status_requested_at
  ON approvals(status, requested_at);
