import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

async function withTempRepo(
  manifestText: string,
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-fanout-"));
  const configPath = path.join(repositoryRoot, "agent-bus.yaml");

  try {
    await writeFile(configPath, manifestText, "utf8");
    await callback(configPath, repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("publish creates durable fan-out deliveries for multiple subscribers", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: tech_lead_claude
    runtime: claude-code
    command: [claude, run]
  - id: qa_antigravity
    runtime: antigravity
    command: [antigravity, run]

subscriptions:
  - agentId: tech_lead_claude
    topic: implementation_ready
  - agentId: qa_antigravity
    topic: implementation_ready

approvalGates: []
artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        recoveryIntervalMs: 5_000
      });

      try {
        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440201",
            topic: "implementation_ready",
            runId: "run-fanout-001",
            correlationId: "run-fanout-001",
            dedupeKey: "implementation_ready:run-fanout-001",
            occurredAt: "2026-03-09T16:30:00Z",
            producer: {
              agentId: "tech_lead_claude",
              runtime: "claude-code"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const deliveries = daemon.listDeliveriesForEvent(
          "550e8400-e29b-41d4-a716-446655440201"
        );
        const notifications = daemon.dispatcherSnapshot();

        assert.equal(deliveries.length, 2);
        assert.deepEqual(
          deliveries.map((delivery) => [delivery.agentId, delivery.status]),
          [
            ["qa_antigravity", "ready"],
            ["tech_lead_claude", "ready"]
          ]
        );
        assert.deepEqual(
          notifications.map((notification) => notification.state),
          ["ready_for_delivery", "ready_for_delivery"]
        );
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("approval decisions unlock or cancel pending deliveries durably", async () => {
  await withTempRepo(
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
  - id: qa_antigravity
    runtime: antigravity
    command: [antigravity, run]

subscriptions:
  - agentId: tech_lead_claude
    topic: plan_done
  - agentId: qa_antigravity
    topic: plan_done

approvalGates:
  - topic: plan_done
    decision: manual
    approvers: [human]
    onReject: return_to_producer

artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        recoveryIntervalMs: 5_000
      });

      try {
        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440202",
            topic: "plan_done",
            runId: "run-fanout-002",
            correlationId: "run-fanout-002",
            dedupeKey: "plan_done:run-fanout-002",
            occurredAt: "2026-03-09T16:35:00Z",
            producer: {
              agentId: "ba_codex",
              runtime: "codex"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const pendingApproval = daemon.getApprovalForEvent(
          "550e8400-e29b-41d4-a716-446655440202"
        );

        assert.ok(pendingApproval);
        assert.equal(pendingApproval?.status, "pending");
        assert.deepEqual(
          daemon.listDeliveriesForEvent("550e8400-e29b-41d4-a716-446655440202").map(
            (delivery) => delivery.status
          ),
          ["pending_approval", "pending_approval"]
        );

        const approved = daemon.approve(
          pendingApproval?.approvalId as string,
          "human-approver"
        );

        assert.equal(approved.approval.status, "approved");
        assert.equal(approved.event.approvalStatus, "approved");
        assert.deepEqual(
          approved.deliveries.map((delivery) => delivery.status),
          ["ready", "ready"]
        );
        assert.equal(
          daemon.dispatcherSnapshot().filter(
            (notification) => notification.state === "ready_for_delivery"
          ).length,
          2
        );

        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440203",
            topic: "plan_done",
            runId: "run-fanout-003",
            correlationId: "run-fanout-003",
            dedupeKey: "plan_done:run-fanout-003",
            occurredAt: "2026-03-09T16:36:00Z",
            producer: {
              agentId: "ba_codex",
              runtime: "codex"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const rejectedApproval = daemon.getApprovalForEvent(
          "550e8400-e29b-41d4-a716-446655440203"
        );
        const rejected = daemon.reject(
          rejectedApproval?.approvalId as string,
          "human-approver",
          "Need a clearer plan."
        );

        assert.equal(rejected.approval.status, "rejected");
        assert.equal(rejected.event.approvalStatus, "rejected");
        assert.equal(rejected.approval.feedback, "Need a clearer plan.");
        assert.deepEqual(
          rejected.deliveries.map((delivery) => delivery.status),
          ["cancelled", "cancelled"]
        );
        assert.equal(
          daemon.dispatcherSnapshot().filter(
            (notification) =>
              notification.eventId === "550e8400-e29b-41d4-a716-446655440203" &&
              notification.state === "ready_for_delivery"
          ).length,
          0
        );
      } finally {
        await daemon.stop();
      }
    }
  );
});
