import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

const successAdapterPath = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/success-adapter.mjs"
);

async function withTempRepo(
  manifestText: string,
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-runtime-adapters-"));
  const configPath = path.join(repositoryRoot, "agent-bus.yaml");

  try {
    await writeFile(configPath, manifestText, "utf8");
    await callback(configPath, repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("runtime adapters hand off artifacts across codex, open-code, and antigravity identities", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: ba_codex
    runtime: codex
    command: ["${process.execPath}", "${successAdapterPath}"]
  - id: coder_open_code
    runtime: open-code
    command: ["${process.execPath}", "${successAdapterPath}"]
  - id: qa_antigravity
    runtime: antigravity
    command: ["${process.execPath}", "${successAdapterPath}"]

subscriptions:
  - agentId: ba_codex
    topic: draft_ready
  - agentId: coder_open_code
    topic: plan_done
  - agentId: qa_antigravity
    topic: implementation_done

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
            eventId: "550e8400-e29b-41d4-a716-446655440401",
            topic: "draft_ready",
            runId: "run-runtime-e2e-001",
            correlationId: "run-runtime-e2e-001",
            dedupeKey: "draft_ready:run-runtime-e2e-001",
            occurredAt: "2026-03-10T06:00:00Z",
            producer: {
              agentId: "human",
              runtime: "codex"
            },
            payload: {
              nextTopic: "plan_done",
              emittedPayload: {
                nextTopic: "implementation_done",
                emittedPayload: {
                  nextTopic: "qa_done"
                }
              }
            },
            payloadMetadata: {},
            artifactRefs: [
              {
                path: "docs/brief.md",
                role: "input"
              }
            ]
          })
        );

        const codexExecution = await daemon.runWorkerIteration("worker-codex", 60_000);
        const openCodeExecution = await daemon.runWorkerIteration("worker-open-code", 60_000);
        const antigravityExecution = await daemon.runWorkerIteration("worker-antigravity", 60_000);

        assert.ok(codexExecution);
        assert.ok(openCodeExecution);
        assert.ok(antigravityExecution);
        assert.equal(codexExecution?.delivery.agentId, "ba_codex");
        assert.equal(openCodeExecution?.delivery.agentId, "coder_open_code");
        assert.equal(antigravityExecution?.delivery.agentId, "qa_antigravity");
        assert.equal(codexExecution?.status, "success");
        assert.equal(openCodeExecution?.status, "success");
        assert.equal(antigravityExecution?.status, "success");
      } finally {
        await daemon.stop();
      }
    }
  );
});

for (const executable of ["codex", "opencode", "antigravity"] as const) {
  test(`runtime smoke check skips cleanly or prints help for ${executable}`, () => {
    const available = spawnSync("sh", ["-lc", `command -v ${executable}`], {
      encoding: "utf8"
    });

    if (available.status !== 0) {
      return;
    }

    const help = spawnSync(executable, ["--help"], {
      encoding: "utf8",
      timeout: 5_000
    });

    assert.equal(help.status, 0);
  });
}
