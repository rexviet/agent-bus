ALTER TABLE deliveries ADD COLUMN lease_token TEXT;
ALTER TABLE deliveries ADD COLUMN lease_owner TEXT;
ALTER TABLE deliveries ADD COLUMN lease_expires_at TEXT;
ALTER TABLE deliveries ADD COLUMN claimed_at TEXT;
ALTER TABLE deliveries ADD COLUMN completed_at TEXT;
ALTER TABLE deliveries ADD COLUMN last_attempted_at TEXT;
ALTER TABLE deliveries ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE deliveries ADD COLUMN dead_lettered_at TEXT;
ALTER TABLE deliveries ADD COLUMN dead_letter_reason TEXT;
ALTER TABLE deliveries ADD COLUMN replay_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN replayed_from_delivery_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_event_agent
  ON deliveries(event_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_claimable
  ON deliveries(status, available_at, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_event_status
  ON deliveries(event_id, status);
