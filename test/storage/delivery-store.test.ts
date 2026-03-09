import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { parseEventEnvelope } from "../../src/domain/event-envelope.js";
import { createDeliveryStore } from "../../src/storage/delivery-store.js";
import { createEventStore } from "../../src/storage/event-store.js";
import { migrateDatabase } from "../../src/storage/migrate.js";
import { createRunStore } from "../../src/storage/run-store.js";
import { openSqliteDatabase } from "../../src/storage/sqlite-client.js";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void>
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-bus-delivery-store-"));
  const databasePath = path.join(tempDir, "agent-bus.sqlite");

  try {
    await callback(databasePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("delivery store persists ready deliveries for subscribed agents", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const eventStore = createEventStore(database);
      const deliveryStore = createDeliveryStore(database);

      runStore.createRun({ runId: "run-001", status: "active" });

      const persistedEvent = eventStore.insertEvent({
        envelope: parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440101",
          topic: "implementation_ready",
          runId: "run-001",
          correlationId: "run-001",
          dedupeKey: "implementation_ready:run-001",
          occurredAt: "2026-03-09T16:00:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      });

      const deliveries = deliveryStore.planDeliveries({
        eventId: persistedEvent.eventId,
        topic: persistedEvent.topic,
        agentIds: ["coder_open_code", "qa_antigravity"],
        status: "ready",
        availableAt: persistedEvent.createdAt
      });

      assert.equal(deliveries.length, 2);
      assert.deepEqual(
        deliveries.map((delivery) => delivery.agentId),
        ["coder_open_code", "qa_antigravity"]
      );
      assert.deepEqual(
        deliveryStore.listReadyDeliveries(persistedEvent.createdAt).map((delivery) => delivery.deliveryId),
        deliveries.map((delivery) => delivery.deliveryId)
      );
    } finally {
      database.close();
    }
  });
});
