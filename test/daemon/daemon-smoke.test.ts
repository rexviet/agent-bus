import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const manifestTemplate = await readFile("agent-bus.example.yaml", "utf8");
    await writeFile(path.join(tempRepoPath, "agent-bus.yaml"), manifestTemplate, "utf8");
    await callback(tempRepoPath);
  } finally {
    await rm(tempRepoPath, { recursive: true, force: true });
  }
}

test("startDaemon boots, publishes durably, and shuts down cleanly", async () => {
  await withTempRepo(async (tempRepoPath) => {
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
      assert.equal(daemon.layout.workspaceDir, path.join(tempRepoPath, "workspace"));
      assert.equal(daemon.layout.stateDir, path.join(tempRepoPath, ".agent-bus", "state"));
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        eventId: "550e8400-e29b-41d4-a716-446655440004",
        topic: "plan_done",
        state: "approval_pending",
        recordedAt: notifications[0]?.recordedAt
      });
      assert.equal(daemon.runRecoveryScan(), 1);
      assert.equal(daemon.dispatcherSnapshot().length, 1);
    } finally {
      await daemon.stop();
    }
  });
});
