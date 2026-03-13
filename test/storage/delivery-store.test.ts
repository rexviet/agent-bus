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

function minutesAfter(timestamp: string, minutes: number): string {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

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
        agentIds: ["coder_open_code", "qa_gemini"],
        status: "ready",
        availableAt: persistedEvent.createdAt
      });

      assert.equal(deliveries.length, 2);
      assert.deepEqual(
        deliveries.map((delivery) => delivery.agentId),
        ["coder_open_code", "qa_gemini"]
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
        agentIds: ["tech_lead_claude", "qa_gemini"],
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

test("delivery store rejects duplicate planning for the same event and agent", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const eventStore = createEventStore(database);
      const deliveryStore = createDeliveryStore(database);

      runStore.createRun({ runId: "run-duplicate-001", status: "active" });

      const persistedEvent = eventStore.insertEvent({
        envelope: parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440103",
          topic: "implementation_ready",
          runId: "run-duplicate-001",
          correlationId: "run-duplicate-001",
          dedupeKey: "implementation_ready:run-duplicate-001",
          occurredAt: "2026-03-09T16:15:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      });

      assert.throws(() =>
        deliveryStore.planDeliveries({
          eventId: persistedEvent.eventId,
          topic: persistedEvent.topic,
          agentIds: ["coder_open_code", "coder_open_code"],
          status: "ready"
        })
      );
    } finally {
      database.close();
    }
  });
});

test("replay clears terminal execution metadata and resets attempt count", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const eventStore = createEventStore(database);
      const deliveryStore = createDeliveryStore(database);

      runStore.createRun({ runId: "run-replay-001", status: "active" });

      const persistedEvent = eventStore.insertEvent({
        envelope: parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440104",
          topic: "implementation_ready",
          runId: "run-replay-001",
          correlationId: "run-replay-001",
          dedupeKey: "implementation_ready:run-replay-001",
          occurredAt: "2026-03-09T16:20:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      });

      deliveryStore.planDeliveries({
        eventId: persistedEvent.eventId,
        topic: persistedEvent.topic,
        agentIds: ["coder_open_code"],
        status: "ready",
        availableAt: persistedEvent.createdAt
      });

      const claimed = deliveryStore.claimNextDelivery({
        workerId: "worker-1",
        leaseDurationMs: 60_000,
        asOf: minutesAfter(persistedEvent.createdAt, 1)
      });

      assert.ok(claimed);

      const completed = deliveryStore.acknowledgeDelivery({
        deliveryId: claimed?.deliveryId as string,
        leaseToken: claimed?.leaseToken as string
      });

      assert.equal(completed.status, "completed");
      assert.ok(completed.completedAt);
      assert.ok(completed.claimedAt);
      assert.ok(completed.lastAttemptedAt);

      const replayed = deliveryStore.replayDelivery({
        deliveryId: completed.deliveryId,
        availableAt: minutesAfter(persistedEvent.createdAt, 2)
      });

      assert.equal(replayed.status, "ready");
      assert.equal(replayed.availableAt, minutesAfter(persistedEvent.createdAt, 2));
      assert.equal(replayed.attemptCount, 0);
      assert.equal(replayed.replayCount, 1);
      assert.equal(replayed.replayedFromDeliveryId, completed.deliveryId);
      assert.equal(replayed.claimedAt, undefined);
      assert.equal(replayed.completedAt, undefined);
      assert.equal(replayed.lastAttemptedAt, undefined);
      assert.equal(replayed.lastError, undefined);
      assert.equal(replayed.deadLetteredAt, undefined);
      assert.equal(replayed.deadLetterReason, undefined);
    } finally {
      database.close();
    }
  });
});

test("delivery store lists run-scoped deliveries and failure views with event metadata", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const eventStore = createEventStore(database);
      const deliveryStore = createDeliveryStore(database);

      runStore.createRun({ runId: "run-failure-001", status: "active" });

      const persistedEvent = eventStore.insertEvent({
        envelope: parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440105",
          topic: "implementation_ready",
          runId: "run-failure-001",
          correlationId: "run-failure-001",
          dedupeKey: "implementation_ready:run-failure-001",
          occurredAt: "2026-03-09T16:25:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        }),
        approvalStatus: "approved"
      });

      deliveryStore.planDeliveries({
        eventId: persistedEvent.eventId,
        topic: persistedEvent.topic,
        agentIds: ["coder_open_code"],
        status: "ready",
        availableAt: persistedEvent.createdAt
      });

      const claimed = deliveryStore.claimNextDelivery({
        workerId: "worker-failure",
        leaseDurationMs: 60_000,
        asOf: minutesAfter(persistedEvent.createdAt, 1)
      });

      assert.ok(claimed);

      const failed = deliveryStore.failDelivery({
        deliveryId: claimed?.deliveryId as string,
        leaseToken: claimed?.leaseToken as string,
        errorMessage: "adapter failed",
        retryDelayMs: 0,
        asOf: minutesAfter(persistedEvent.createdAt, 1)
      });

      assert.equal(failed.status, "retry_scheduled");

      const runDeliveries = deliveryStore.listDeliveriesForRun("run-failure-001");
      const failures = deliveryStore.listFailureDeliveries();

      assert.equal(runDeliveries.length, 1);
      assert.equal(runDeliveries[0]?.runId, "run-failure-001");
      assert.equal(runDeliveries[0]?.approvalStatus, "approved");
      assert.equal(runDeliveries[0]?.correlationId, "run-failure-001");
      assert.equal(failures.length, 1);
      assert.equal(failures[0]?.deliveryId, failed.deliveryId);
      assert.equal(failures[0]?.lastError, "adapter failed");
      assert.equal(failures[0]?.eventOccurredAt, "2026-03-09T16:25:00Z");
    } finally {
      database.close();
    }
  });
});
