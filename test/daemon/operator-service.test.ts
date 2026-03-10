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
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-operator-"));
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
  - id: tech_lead_claude
    runtime: claude-code
    command: [claude, run]
  - id: coder_open_code
    runtime: open-code
    command: [open-code, run]

subscriptions:
  - agentId: tech_lead_claude
    topic: plan_done
  - agentId: coder_open_code
    topic: implementation_ready

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

test("operator service exposes derived run summaries, pending approvals, and failures", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    const daemon = await startDaemon({
      configPath,
      repositoryRoot,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      const gatedEvent = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440501",
          topic: "plan_done",
          runId: "run-ops-001",
          correlationId: "run-ops-001",
          dedupeKey: "plan_done:run-ops-001",
          occurredAt: "2026-03-09T17:00:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: [
            {
              path: "docs/plan.md",
              role: "primary"
            }
          ]
        })
      );
      const gatedApproval = daemon.getApprovalForEvent(gatedEvent.eventId);

      assert.ok(gatedApproval);

      const implementationEvent = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440502",
          topic: "implementation_ready",
          runId: "run-ops-002",
          correlationId: "run-ops-002",
          dedupeKey: "implementation_ready:run-ops-002",
          occurredAt: "2026-03-09T17:05:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      const claimed = daemon.claimDelivery("worker-operator", 60_000);

      assert.ok(claimed);

      const failed = daemon.failDelivery(
        claimed?.deliveryId as string,
        claimed?.leaseToken as string,
        "adapter crashed",
        0,
        "2026-03-09T17:06:00Z"
      );

      assert.equal(failed.status, "retry_scheduled");

      const summaries = daemon.listRunSummaries();
      const gatedSummary = summaries.find((run) => run.runId === "run-ops-001");
      const failureSummary = summaries.find((run) => run.runId === "run-ops-002");
      const pendingApprovals = daemon.listPendingApprovalViews();
      const failures = daemon.listFailureDeliveries();
      const failureDetail = daemon.getRunDetail("run-ops-002");

      assert.equal(gatedSummary?.status, "awaiting_approval");
      assert.equal(gatedSummary?.approvalCount, 1);
      assert.equal(gatedSummary?.deliveryStatusCounts.pendingApproval, 1);
      assert.equal(failureSummary?.status, "attention_required");
      assert.equal(failureSummary?.deliveryStatusCounts.retryScheduled, 1);
      assert.equal(pendingApprovals.length, 1);
      assert.deepEqual(pendingApprovals[0], {
        approvalId: gatedApproval?.approvalId,
        eventId: gatedEvent.eventId,
        runId: "run-ops-001",
        topic: "plan_done",
        status: "pending",
        requestedAt: pendingApprovals[0]?.requestedAt,
        producerAgentId: "ba_codex",
        approvalStatus: "pending",
        deliveryCount: 1
      });
      assert.equal(failures.length, 1);
      assert.equal(failures[0]?.runId, implementationEvent.runId);
      assert.equal(failures[0]?.producerAgentId, "tech_lead_claude");
      assert.equal(failures[0]?.lastError, "adapter crashed");
      assert.ok(failureDetail);
      assert.equal(failureDetail?.events.length, 1);
      assert.equal(failureDetail?.deliveries.length, 1);
      assert.equal(failureDetail?.status, "attention_required");
    } finally {
      await daemon.stop();
    }
  });
});
