import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

async function withTempRepo(
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-orchestration-"));
  const configPath = path.join(repositoryRoot, "agent-bus.yaml");

  try {
    await writeFile(
      configPath,
      `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: ba_codex
    runtime: codex
    command: [codex, run]
  - id: coder_open_code
    runtime: open-code
    command: [open-code, run]

subscriptions:
  - agentId: coder_open_code
    topic: plan_done

approvalGates:
  - topic: plan_done
    decision: manual
    approvers: [human]
    onReject: return_to_producer

artifactConventions: []
`,
      "utf8"
    );
    await callback(configPath, repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("orchestration core supports publish approval claim and acknowledge", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    const daemon = await startDaemon({
      configPath,
      repositoryRoot,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      const event = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440401",
          topic: "plan_done",
          runId: "run-core-001",
          correlationId: "run-core-001",
          dedupeKey: "plan_done:run-core-001",
          occurredAt: "2026-03-09T16:50:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      const approval = daemon.getApprovalForEvent(event.eventId);

      assert.ok(approval);
      assert.equal(approval?.status, "pending");

      const approved = daemon.approve(approval?.approvalId as string, "human");
      const readyDelivery = approved.deliveries[0];

      assert.equal(approved.event.approvalStatus, "approved");
      assert.equal(readyDelivery?.status, "ready");

      const leased = daemon.claimDelivery("worker-happy", 60_000);

      assert.ok(leased);
      const completed = daemon.acknowledgeDelivery(
        leased?.deliveryId as string,
        leased?.leaseToken as string
      );

      assert.equal(completed.status, "completed");
      assert.equal(
        daemon.listDeliveriesForEvent(event.eventId)[0]?.status,
        "completed"
      );
    } finally {
      await daemon.stop();
    }
  });
});

test("orchestration core supports failure dead-letter and replay", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    const daemon = await startDaemon({
      configPath,
      repositoryRoot,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      const event = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440402",
          topic: "plan_done",
          runId: "run-core-002",
          correlationId: "run-core-002",
          dedupeKey: "plan_done:run-core-002",
          occurredAt: "2026-03-09T16:51:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      const approval = daemon.getApprovalForEvent(event.eventId);
      daemon.approve(approval?.approvalId as string, "human");

      let terminalStatus = "";

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const leased = daemon.claimDelivery(`worker-${attempt}`, 60_000);

        assert.ok(leased);

        terminalStatus = daemon.failDelivery(
          leased?.deliveryId as string,
          leased?.leaseToken as string,
          `failure-${attempt}`,
          0
        ).status;
      }

      assert.equal(terminalStatus, "dead_letter");

      const replayed = daemon.replayEvent(event.eventId);

      assert.equal(replayed.event.eventId, event.eventId);
      assert.equal(replayed.deliveries.length, 1);
      assert.equal(replayed.deliveries[0]?.status, "ready");
      assert.equal(replayed.deliveries[0]?.attemptCount, 0);
      assert.equal(replayed.deliveries[0]?.replayCount, 1);
      assert.equal(replayed.deliveries[0]?.claimedAt, undefined);
      assert.equal(replayed.deliveries[0]?.completedAt, undefined);
      assert.equal(replayed.deliveries[0]?.lastAttemptedAt, undefined);
      assert.equal(replayed.deliveries[0]?.lastError, undefined);
      assert.equal(replayed.deliveries[0]?.deadLetterReason, undefined);

      const replayClaim = daemon.claimDelivery("worker-replay", 60_000);

      assert.ok(replayClaim);
      assert.equal(replayClaim?.attemptCount, 1);
      const replayCompleted = daemon.acknowledgeDelivery(
        replayClaim?.deliveryId as string,
        replayClaim?.leaseToken as string
      );

      assert.equal(replayCompleted.status, "completed");
      assert.equal(
        daemon.listDeliveriesForEvent(event.eventId)[0]?.status,
        "completed"
      );
    } finally {
      await daemon.stop();
    }
  });
});

test("replay cannot bypass rejected approval gates", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    const daemon = await startDaemon({
      configPath,
      repositoryRoot,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      const event = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440403",
          topic: "plan_done",
          runId: "run-core-003",
          correlationId: "run-core-003",
          dedupeKey: "plan_done:run-core-003",
          occurredAt: "2026-03-09T16:52:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      const approval = daemon.getApprovalForEvent(event.eventId);

      assert.ok(approval);

      daemon.reject(approval?.approvalId as string, "human", "Needs rework.");

      const cancelledDelivery = daemon.listDeliveriesForEvent(event.eventId)[0];

      assert.equal(cancelledDelivery?.status, "cancelled");
      assert.throws(
        () => daemon.replayEvent(event.eventId),
        /approved or not_required approval status/
      );
      assert.throws(
        () => daemon.replayDelivery(cancelledDelivery?.deliveryId as string),
        /approved or not_required approval status/
      );
      assert.equal(
        daemon.dispatcherSnapshot().filter(
          (notification) =>
            notification.eventId === event.eventId &&
            notification.state === "ready_for_delivery"
        ).length,
        0
      );
      assert.equal(
        daemon.listDeliveriesForEvent(event.eventId)[0]?.status,
        "cancelled"
      );
    } finally {
      await daemon.stop();
    }
  });
});
