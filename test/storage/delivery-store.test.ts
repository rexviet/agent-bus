import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createApprovalStore } from "../../src/storage/approval-store.js";
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
      const approvalStore = createApprovalStore(database);
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
      assert.equal(deliveries[0]?.maxAttempts, 3);
      assert.equal(approvalStore.listPendingApprovals().length, 0);
    } finally {
      database.close();
    }
  });
});

test("approval store records decisions and delivery transitions preserve lifecycle metadata", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const eventStore = createEventStore(database);
      const approvalStore = createApprovalStore(database);
      const deliveryStore = createDeliveryStore(database);

      runStore.createRun({ runId: "run-approval-001", status: "active" });

      const persistedEvent = eventStore.insertEvent({
        envelope: parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440102",
          topic: "plan_done",
          runId: "run-approval-001",
          correlationId: "run-approval-001",
          dedupeKey: "plan_done:run-approval-001",
          occurredAt: "2026-03-09T16:10:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        }),
        approvalStatus: "pending"
      });

      deliveryStore.planDeliveries({
        eventId: persistedEvent.eventId,
        topic: persistedEvent.topic,
        agentIds: ["tech_lead_claude", "qa_antigravity"],
        status: "pending_approval",
        availableAt: persistedEvent.createdAt,
        maxAttempts: 5
      });

      const pendingApprovals = approvalStore.listPendingApprovals();

      assert.equal(pendingApprovals.length, 1);
      assert.equal(pendingApprovals[0]?.status, "pending");

      const approved = approvalStore.approve({
        approvalId: pendingApprovals[0]?.approvalId as string,
        decidedBy: "human-reviewer"
      });

      const transitionedDeliveries = deliveryStore.transitionEventDeliveries(
        persistedEvent.eventId,
        "pending_approval",
        "ready",
        approved.decidedAt
      );

      assert.equal(approved.status, "approved");
      assert.equal(approved.decidedBy, "human-reviewer");
      assert.equal(approvalStore.listPendingApprovals().length, 0);
      assert.deepEqual(
        transitionedDeliveries.map((delivery) => delivery.status),
        ["ready", "ready"]
      );
      assert.equal(transitionedDeliveries[0]?.maxAttempts, 5);
      assert.equal(
        deliveryStore.listReadyDeliveries(approved.decidedAt).length,
        transitionedDeliveries.length
      );
    } finally {
      database.close();
    }
  });
});
