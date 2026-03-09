import type { DatabaseSync } from "node:sqlite";

export type RunStatus = "pending" | "active" | "completed" | "failed" | "cancelled";

export interface RunRecord {
  readonly runId: string;
  readonly status: RunStatus;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRunInput {
  readonly runId: string;
  readonly status?: RunStatus;
  readonly metadata?: Record<string, unknown>;
}

interface RunRow {
  run_id: string;
  status: RunStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function mapRunRow(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    status: row.status,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createRunStore(database: DatabaseSync) {
  const insertRun = database.prepare(`
    INSERT INTO runs (run_id, status, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const selectRun = database.prepare(`
    SELECT run_id, status, metadata_json, created_at, updated_at
    FROM runs
    WHERE run_id = ?
  `);

  return {
    createRun(input: CreateRunInput): RunRecord {
      const createdAt = new Date().toISOString();
      const status = input.status ?? "pending";
      const metadata = JSON.stringify(input.metadata ?? {});

      insertRun.run(input.runId, status, metadata, createdAt, createdAt);

      const row = selectRun.get(input.runId) as RunRow | undefined;

      if (!row) {
        throw new Error(`Failed to fetch persisted run ${input.runId}.`);
      }

      return mapRunRow(row);
    },

    getRun(runId: string): RunRecord | null {
      const row = selectRun.get(runId) as RunRow | undefined;

      return row ? mapRunRow(row) : null;
    }
  };
}
