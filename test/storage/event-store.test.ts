import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { parseEventEnvelope } from "../../src/domain/event-envelope.js";
import { createEventStore } from "../../src/storage/event-store.js";
import { migrateDatabase } from "../../src/storage/migrate.js";
import { createRunStore } from "../../src/storage/run-store.js";
import { openSqliteDatabase } from "../../src/storage/sqlite-client.js";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void>
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-bus-event-store-"));
  const databasePath = path.join(tempDir, "agent-bus.sqlite");

  try {
    await callback(databasePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("run and event stores persist runs, events, artifacts, and approvals", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const eventStore = createEventStore(database);

      const run = runStore.createRun({
        runId: "run-001",
        status: "active",
        metadata: { workflow: "demo" }
      });

      const persistedEvent = eventStore.insertEvent({
        envelope: parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440001",
          topic: "plan_done",
          runId: "run-001",
          correlationId: "run-001",
          dedupeKey: "plan_done:run-001",
          occurredAt: "2026-03-09T15:10:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {
            stage: "approved"
          },
          payloadMetadata: {
            schemaVersion: 1
          },
          artifactRefs: [
            {
              path: "docs/plan.md",
              role: "primary"
            }
          ]
        }),
        approvalStatus: "pending"
      });

      assert.equal(run.runId, "run-001");
      assert.equal(runStore.getRun("run-001")?.status, "active");
      assert.equal(persistedEvent.approvalStatus, "pending");
      assert.equal(persistedEvent.artifactRefs[0]?.path, "docs/plan.md");
      assert.deepEqual(eventStore.listPendingApprovals(), [
        {
          approvalId: "approval:550e8400-e29b-41d4-a716-446655440001",
          eventId: "550e8400-e29b-41d4-a716-446655440001",
          topic: "plan_done",
          status: "pending",
          requestedAt: persistedEvent.createdAt
        }
      ]);
    } finally {
      database.close();
    }
  });
});

test("event store rejects duplicate dedupe keys", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const eventStore = createEventStore(database);

      runStore.createRun({ runId: "run-001" });

      const envelope = parseEventEnvelope({
        eventId: "550e8400-e29b-41d4-a716-446655440002",
        topic: "plan_done",
        runId: "run-001",
        correlationId: "run-001",
        dedupeKey: "plan_done:run-001",
        occurredAt: "2026-03-09T15:15:00Z",
        producer: {
          agentId: "ba_codex",
          runtime: "codex"
        },
        payload: {},
        payloadMetadata: {},
        artifactRefs: []
      });

      eventStore.insertEvent({ envelope });

      assert.throws(() =>
        eventStore.insertEvent({
          envelope: parseEventEnvelope({
            ...envelope,
            eventId: "550e8400-e29b-41d4-a716-446655440003"
          })
        })
      );
    } finally {
      database.close();
    }
  });
});
