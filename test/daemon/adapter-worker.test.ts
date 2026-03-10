import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";
import { openSqliteDatabase } from "../../src/storage/sqlite-client.js";

const successAdapterPath = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/success-adapter.mjs"
);
const failAdapterPath = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/fail-adapter.mjs"
);

async function withTempRepo(
  manifestText: string,
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-adapter-worker-"));
  const configPath = path.join(repositoryRoot, "agent-bus.yaml");

  try {
    await writeFile(configPath, manifestText, "utf8");
    await callback(configPath, repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("runWorkerIteration executes a successful adapter and republishes emitted events", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: coder_open_code
    runtime: open-code
    command: ["${process.execPath}", "${successAdapterPath}"]
  - id: qa_antigravity
    runtime: antigravity
    command: ["${process.execPath}", "${successAdapterPath}"]

subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready
    requiredArtifacts:
      - path: docs/plan.md
        role: input
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
            eventId: "550e8400-e29b-41d4-a716-446655440301",
            topic: "implementation_ready",
            runId: "run-adapter-001",
            correlationId: "run-adapter-001",
            dedupeKey: "implementation_ready:run-adapter-001",
            occurredAt: "2026-03-10T05:00:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: [
              {
                path: "docs/plan.md",
                role: "input"
              }
            ]
          })
        );

        const execution = await daemon.runWorkerIteration("worker-1", 60_000);

        assert.ok(execution);
        assert.equal(execution?.status, "success");
        assert.equal(execution?.delivery.status, "completed");
        assert.equal(execution?.emittedEvents.length, 1);
        assert.equal(execution?.emittedEvents[0]?.topic, "implementation_done");
        assert.equal(
          daemon.listDeliveriesForEvent(
            execution?.emittedEvents[0]?.eventId as string
          )[0]?.agentId,
          "qa_antigravity"
        );

        const workPackage = JSON.parse(
          await readFile(execution?.workPackagePath as string, "utf8")
        ) as {
          readonly requiredArtifacts: readonly { readonly path: string; readonly role?: string }[];
        };

        assert.deepEqual(workPackage.requiredArtifacts, [
          {
            path: "docs/plan.md",
            role: "input"
          }
        ]);
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration schedules retryable adapter failures", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: coder_open_code
    runtime: open-code
    command: ["${process.execPath}", "${failAdapterPath}"]

subscriptions:
  - agentId: coder_open_code
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
            eventId: "550e8400-e29b-41d4-a716-446655440302",
            topic: "implementation_ready",
            runId: "run-adapter-002",
            correlationId: "run-adapter-002",
            dedupeKey: "implementation_ready:run-adapter-002",
            occurredAt: "2026-03-10T05:05:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {
              mode: "retryable"
            },
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const execution = await daemon.runWorkerIteration("worker-2", 60_000);

        assert.ok(execution);
        assert.equal(execution?.status, "retryable_error");
        assert.equal(execution?.delivery.status, "retry_scheduled");
        assert.equal(execution?.delivery.lastError, "Temporary adapter failure.");
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration dead-letters fatal adapter failures immediately", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: qa_antigravity
    runtime: antigravity
    command: ["${process.execPath}", "${failAdapterPath}"]

subscriptions:
  - agentId: qa_antigravity
    topic: qa_ready

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
            eventId: "550e8400-e29b-41d4-a716-446655440303",
            topic: "qa_ready",
            runId: "run-adapter-003",
            correlationId: "run-adapter-003",
            dedupeKey: "qa_ready:run-adapter-003",
            occurredAt: "2026-03-10T05:10:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {
              mode: "fatal"
            },
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const execution = await daemon.runWorkerIteration("worker-3", 60_000);

        assert.ok(execution);
        assert.equal(execution?.status, "fatal_error");
        assert.equal(execution?.delivery.status, "dead_letter");
        assert.equal(execution?.delivery.deadLetterReason, "Permanent adapter failure.");
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration rolls back emitted events when the worker lease expires", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: coder_open_code
    runtime: open-code
    command: ["${process.execPath}", "${successAdapterPath}"]
  - id: qa_antigravity
    runtime: antigravity
    command: ["${process.execPath}", "${successAdapterPath}"]

subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready
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
        recoveryIntervalMs: 10
      });

      try {
        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440304",
            topic: "implementation_ready",
            runId: "run-adapter-004",
            correlationId: "run-adapter-004",
            dedupeKey: "implementation_ready:run-adapter-004",
            occurredAt: "2026-03-10T05:15:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {
              delayMs: 150
            },
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const firstExecution = await daemon.runWorkerIteration("worker-lease-1", 20);

        assert.ok(firstExecution);
        assert.equal(firstExecution?.status, "process_error");
        assert.equal(firstExecution?.delivery.status, "ready");
        assert.equal(firstExecution?.emittedEvents.length, 0);

        const database = openSqliteDatabase({ databasePath: daemon.databasePath });

        try {
          const persistedTopics = (
            database
              .prepare("SELECT topic FROM events ORDER BY created_at ASC")
              .all() as { readonly topic: string }[]
          ).map((row) => row.topic);
          const persistedDeliveries = database.prepare(
            "SELECT topic, status FROM deliveries ORDER BY created_at ASC"
          ).all() as { readonly topic: string; readonly status: string }[];
          const deliveryRows = persistedDeliveries.map((row) => ({
            topic: row.topic,
            status: row.status
          }));

          assert.deepEqual(persistedTopics, ["implementation_ready"]);
          assert.deepEqual(deliveryRows, [
            {
              topic: "implementation_ready",
              status: "ready"
            }
          ]);
        } finally {
          database.close();
        }

        const secondExecution = await daemon.runWorkerIteration("worker-lease-2", 5_000);

        assert.ok(secondExecution);
        assert.equal(secondExecution?.status, "success");
        assert.equal(secondExecution?.delivery.status, "completed");
        assert.equal(secondExecution?.emittedEvents.length, 1);
        assert.equal(secondExecution?.emittedEvents[0]?.topic, "implementation_done");
      } finally {
        await daemon.stop();
      }
    }
  );
});
