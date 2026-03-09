import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { parseEventEnvelope } from "../../src/domain/event-envelope.js";
import { startDaemon } from "../../src/daemon/index.js";

async function withTempRepo(
  callback: (tempRepoPath: string) => Promise<void>
): Promise<void> {
  const tempRepoPath = await mkdtemp(path.join(os.tmpdir(), "agent-bus-daemon-"));

  try {
    await callback(tempRepoPath);
  } finally {
    await rm(tempRepoPath, { recursive: true, force: true });
  }
}

async function writeManifest(tempRepoPath: string, manifestText: string): Promise<void> {
  await writeFile(path.join(tempRepoPath, "agent-bus.yaml"), manifestText, "utf8");
}

test("startDaemon honors manifest-configured workspace roots and approval notifications", async () => {
  await withTempRepo(async (tempRepoPath) => {
    await writeManifest(
      tempRepoPath,
      `version: 1
workspace:
  artifactsDir: shared-workspace
  stateDir: .runtime/state-store
  logsDir: .runtime/log-output

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
`
    );

    const daemon = await startDaemon({
      configPath: path.join(tempRepoPath, "agent-bus.yaml"),
      repositoryRoot: tempRepoPath,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      const persistedEvent = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440004",
          topic: "plan_done",
          runId: "run-smoke-001",
          correlationId: "run-smoke-001",
          dedupeKey: "plan_done:run-smoke-001",
          occurredAt: "2026-03-09T15:20:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {
            approvedBy: "human"
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
        })
      );

      const notifications = daemon.dispatcherSnapshot();

      assert.equal(persistedEvent.approvalStatus, "pending");
      assert.equal(daemon.layout.workspaceDir, path.join(tempRepoPath, "shared-workspace"));
      assert.equal(
        daemon.layout.stateDir,
        path.join(tempRepoPath, ".runtime", "state-store")
      );
      assert.equal(
        daemon.layout.logsDir,
        path.join(tempRepoPath, ".runtime", "log-output")
      );
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        eventId: "550e8400-e29b-41d4-a716-446655440004",
        topic: "plan_done",
        state: "approval_pending",
        approvalId: "approval:550e8400-e29b-41d4-a716-446655440004",
        recordedAt: notifications[0]?.recordedAt
      });
      assert.equal(daemon.runRecoveryScan(), 1);
      assert.equal(daemon.dispatcherSnapshot().length, 1);
    } finally {
      await daemon.stop();
    }
  });
});

test("ready deliveries survive daemon restart and recover from durable storage", async () => {
  await withTempRepo(async (tempRepoPath) => {
    await writeManifest(
      tempRepoPath,
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
`
    );

    const configPath = path.join(tempRepoPath, "agent-bus.yaml");
    const firstDaemon = await startDaemon({
      configPath,
      repositoryRoot: tempRepoPath,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      firstDaemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440005",
          topic: "implementation_ready",
          runId: "run-smoke-002",
          correlationId: "run-smoke-002",
          dedupeKey: "implementation_ready:run-smoke-002",
          occurredAt: "2026-03-09T15:30:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );
    } finally {
      await firstDaemon.stop();
    }

    const secondDaemon = await startDaemon({
      configPath,
      repositoryRoot: tempRepoPath,
      registerSignalHandlers: false,
      recoveryIntervalMs: 5_000
    });

    try {
      const notifications = secondDaemon.dispatcherSnapshot();

      assert.equal(secondDaemon.runRecoveryScan(), 1);
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        eventId: "550e8400-e29b-41d4-a716-446655440005",
        topic: "implementation_ready",
        state: "ready_for_delivery",
        deliveryId: "delivery:550e8400-e29b-41d4-a716-446655440005:coder_open_code",
        agentId: "coder_open_code",
        recordedAt: notifications[0]?.recordedAt
      });
      assert.equal(secondDaemon.dispatcherSnapshot().length, 1);
    } finally {
      await secondDaemon.stop();
    }
  });
});
