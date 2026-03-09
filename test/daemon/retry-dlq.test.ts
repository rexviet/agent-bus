import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

function minutesAfter(timestamp: string, minutes: number): string {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

async function withTempRepo(
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-retry-"));
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
  - id: tech_lead_claude
    runtime: claude-code
    command: [claude, run]
  - id: coder_open_code
    runtime: open-code
    command: [open-code, run]

subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready

approvalGates: []
artifactConventions: []
`,
      "utf8"
    );
    await callback(configPath, repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("delivery retries become claimable again and expired leases are reclaimed", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    const daemon = await startDaemon({
      configPath,
      repositoryRoot,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440301",
          topic: "implementation_ready",
          runId: "run-retry-001",
          correlationId: "run-retry-001",
          dedupeKey: "implementation_ready:run-retry-001",
          occurredAt: "2026-03-09T16:40:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      const claimed = daemon.claimDelivery("worker-1", 60_000);

      assert.ok(claimed);
      assert.equal(claimed?.status, "leased");
      assert.equal(claimed?.attemptCount, 1);

      const scheduledRetry = daemon.failDelivery(
        claimed?.deliveryId as string,
        claimed?.leaseToken as string,
        "temporary adapter failure",
        0
      );

      assert.equal(scheduledRetry.status, "retry_scheduled");
      assert.equal(scheduledRetry.lastError, "temporary adapter failure");

      const retried = daemon.claimDelivery("worker-2", 60_000);

      assert.ok(retried);
      assert.equal(retried?.attemptCount, 2);

      const leaseToExpire = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440302",
          topic: "implementation_ready",
          runId: "run-retry-002",
          correlationId: "run-retry-002",
          dedupeKey: "implementation_ready:run-retry-002",
          occurredAt: "2026-03-09T16:42:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      const leased = daemon.claimDelivery("worker-3", 1);

      assert.ok(leased);
      assert.equal(leaseToExpire.eventId, leased?.eventId);

      await delay(10);
      daemon.runRecoveryScan();

      const reclaimed = daemon.listDeliveriesForEvent(leaseToExpire.eventId)[0];

      assert.equal(reclaimed?.status, "ready");
      assert.equal(
        daemon.dispatcherSnapshot().filter(
          (notification) =>
            notification.eventId === leaseToExpire.eventId &&
            notification.state === "ready_for_delivery"
        ).length,
        2
      );
    } finally {
      await daemon.stop();
    }
  });
});

test("exhausted deliveries transition into dead-letter state", async () => {
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
          eventId: "550e8400-e29b-41d4-a716-446655440303",
          topic: "implementation_ready",
          runId: "run-retry-003",
          correlationId: "run-retry-003",
          dedupeKey: "implementation_ready:run-retry-003",
          occurredAt: "2026-03-09T16:43:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      let failureResult;

      for (const [index, timestamp] of [1, 2, 3].map((minute) =>
        minutesAfter(event.createdAt, minute)
      ).entries()) {
        const claimed = daemon.claimDelivery(`worker-${index + 1}`, 60_000, timestamp);

        assert.ok(claimed);

        failureResult = daemon.failDelivery(
          claimed?.deliveryId as string,
          claimed?.leaseToken as string,
          `failure-${index + 1}`,
          0,
          timestamp
        );
      }

      assert.ok(failureResult);
      assert.equal(failureResult?.status, "dead_letter");
      assert.equal(failureResult?.deadLetterReason, "failure-3");
      assert.equal(failureResult?.attemptCount, 3);
      assert.equal(
        daemon.listDeliveriesForEvent(event.eventId)[0]?.status,
        "dead_letter"
      );
    } finally {
      await daemon.stop();
    }
  });
});

test("replayed dead-letter deliveries start with a fresh retry budget", async () => {
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
          eventId: "550e8400-e29b-41d4-a716-446655440304",
          topic: "implementation_ready",
          runId: "run-retry-004",
          correlationId: "run-retry-004",
          dedupeKey: "implementation_ready:run-retry-004",
          occurredAt: "2026-03-09T16:46:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      for (const [index, timestamp] of [1, 2, 3].map((minute) =>
        minutesAfter(event.createdAt, minute)
      ).entries()) {
        const claimed = daemon.claimDelivery(`worker-${index + 1}`, 60_000, timestamp);

        assert.ok(claimed);

        daemon.failDelivery(
          claimed?.deliveryId as string,
          claimed?.leaseToken as string,
          `failure-${index + 1}`,
          0,
          timestamp
        );
      }

      const replayed = daemon.replayEvent(
        event.eventId,
        minutesAfter(event.createdAt, 4)
      );

      assert.equal(replayed.deliveries[0]?.status, "ready");
      assert.equal(replayed.deliveries[0]?.attemptCount, 0);
      assert.equal(replayed.deliveries[0]?.replayCount, 1);
      assert.equal(replayed.deliveries[0]?.claimedAt, undefined);
      assert.equal(replayed.deliveries[0]?.completedAt, undefined);
      assert.equal(replayed.deliveries[0]?.lastAttemptedAt, undefined);
      assert.equal(replayed.deliveries[0]?.lastError, undefined);
      assert.equal(replayed.deliveries[0]?.deadLetterReason, undefined);

      const replayClaim = daemon.claimDelivery(
        "worker-replay",
        60_000,
        minutesAfter(event.createdAt, 4)
      );

      assert.ok(replayClaim);
      assert.equal(replayClaim?.attemptCount, 1);

      const retryResult = daemon.failDelivery(
        replayClaim?.deliveryId as string,
        replayClaim?.leaseToken as string,
        "replay-failure",
        0,
        minutesAfter(event.createdAt, 4)
      );

      assert.equal(retryResult.status, "retry_scheduled");
      assert.equal(retryResult.attemptCount, 1);
      assert.equal(retryResult.lastError, "replay-failure");
    } finally {
      await daemon.stop();
    }
  });
});
