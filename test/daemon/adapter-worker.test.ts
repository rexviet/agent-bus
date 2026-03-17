import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";
import {
  createDaemonLogger,
  type DaemonLogDestination
} from "../../src/daemon/logger.js";
import { openSqliteDatabase } from "../../src/storage/sqlite-client.js";

const successAdapterPath = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/success-adapter.mjs"
);
const failAdapterPath = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/fail-adapter.mjs"
);
const monitorFixturePath = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/monitor-fixture.mjs"
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

function createLogCapture(): {
  readonly destination: DaemonLogDestination;
  readEntries(): Array<Record<string, unknown>>;
} {
  let output = "";

  return {
    destination: {
      write(message: string): void {
        output += message;
      }
    },
    readEntries(): Array<Record<string, unknown>> {
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }
  };
}

function assertCorrelationFields(
  entries: readonly Record<string, unknown>[],
  expected: {
    readonly deliveryId: string;
    readonly agentId: string;
    readonly runId: string;
  }
): void {
  for (const entry of entries) {
    assert.equal(entry.deliveryId, expected.deliveryId);
    assert.equal(entry.agentId, expected.agentId);
    assert.equal(entry.runId, expected.runId);
    assert.equal(typeof entry.level, "number");
    assert.equal(typeof entry.timestamp, "string");
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
  - id: qa_gemini
    runtime: gemini
    command: ["${process.execPath}", "${successAdapterPath}"]

subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready
    requiredArtifacts:
      - path: docs/plan.md
        role: input
  - agentId: qa_gemini
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
          "qa_gemini"
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
  - id: qa_gemini
    runtime: gemini
    command: ["${process.execPath}", "${failAdapterPath}"]

subscriptions:
  - agentId: qa_gemini
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
  - id: qa_gemini
    runtime: gemini
    command: ["${process.execPath}", "${successAdapterPath}"]

subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready
  - agentId: qa_gemini
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

test("runWorkerIteration schedules retry when agent times out", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: slow_agent
    runtime: codex
    timeout: 1
    command: ["${process.execPath}", "${monitorFixturePath}", "--"]
    environment:
      FIXTURE_DELAY_MS: "5000"

subscriptions:
  - agentId: slow_agent
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
            eventId: "550e8400-e29b-41d4-a716-446655440304",
            topic: "implementation_ready",
            runId: "run-adapter-timeout-001",
            correlationId: "run-adapter-timeout-001",
            dedupeKey: "implementation_ready:run-adapter-timeout-001",
            occurredAt: "2026-03-10T05:15:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const execution = await daemon.runWorkerIteration("worker-timeout", 60_000);

        assert.ok(execution);
        assert.equal(execution?.status, "process_error");
        assert.equal(execution?.delivery.status, "retry_scheduled");
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration completes successfully when agent has no timeout configured", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: quick_agent
    runtime: codex
    command: ["${process.execPath}", "${successAdapterPath}"]

subscriptions:
  - agentId: quick_agent
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
            eventId: "550e8400-e29b-41d4-a716-446655440305",
            topic: "implementation_ready",
            runId: "run-adapter-no-timeout-001",
            correlationId: "run-adapter-no-timeout-001",
            dedupeKey: "implementation_ready:run-adapter-no-timeout-001",
            occurredAt: "2026-03-10T05:20:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const execution = await daemon.runWorkerIteration("worker-no-timeout", 60_000);

        assert.ok(execution);
        assert.equal(execution?.status, "success");
        assert.equal(execution?.delivery.status, "completed");
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration logs success lifecycle events with correlation fields", async () => {
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

subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready

approvalGates: []
artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const capture = createLogCapture();
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        recoveryIntervalMs: 5_000,
        logger: createDaemonLogger("info", capture.destination)
      });

      try {
        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440351",
            topic: "implementation_ready",
            runId: "run-adapter-log-success-001",
            correlationId: "run-adapter-log-success-001",
            dedupeKey: "implementation_ready:run-adapter-log-success-001",
            occurredAt: "2026-03-10T06:00:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const execution = await daemon.runWorkerIteration("worker-log-success", 60_000);

        assert.ok(execution);
        assert.equal(execution.status, "success");

        const entries = capture
          .readEntries()
          .filter((entry) => entry.event !== "mcp.started");
        const lifecycleEntries = entries.filter(
          (entry) => entry.event !== "dashboard.started"
        );

        assert.deepEqual(
          entries.map((entry) => entry.event),
          ["dashboard.started", "delivery.claimed", "agent.started", "delivery.completed"]
        );
        assertCorrelationFields(lifecycleEntries, {
          deliveryId: execution.delivery.deliveryId,
          agentId: "coder_open_code",
          runId: "run-adapter-log-success-001"
        });
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration logs retry scheduling for retryable adapter failures", async () => {
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
      const capture = createLogCapture();
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        recoveryIntervalMs: 5_000,
        logger: createDaemonLogger("info", capture.destination)
      });

      try {
        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440352",
            topic: "implementation_ready",
            runId: "run-adapter-log-retry-001",
            correlationId: "run-adapter-log-retry-001",
            dedupeKey: "implementation_ready:run-adapter-log-retry-001",
            occurredAt: "2026-03-10T06:05:00Z",
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

        const execution = await daemon.runWorkerIteration("worker-log-retry", 60_000);

        assert.ok(execution);
        assert.equal(execution.status, "retryable_error");

        const entries = capture
          .readEntries()
          .filter((entry) => entry.event !== "mcp.started");
        const lifecycleEntries = entries.filter(
          (entry) => entry.event !== "dashboard.started"
        );

        assert.deepEqual(
          entries.map((entry) => entry.event),
          [
            "dashboard.started",
            "delivery.claimed",
            "agent.started",
            "delivery.retry_scheduled"
          ]
        );
        assert.equal(entries[3]?.errorMessage, "Temporary adapter failure.");
        assert.equal(entries[3]?.level, 30);
        assertCorrelationFields(lifecycleEntries, {
          deliveryId: execution.delivery.deliveryId,
          agentId: "coder_open_code",
          runId: "run-adapter-log-retry-001"
        });
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration logs dead-lettering for fatal adapter failures", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: qa_gemini
    runtime: gemini
    command: ["${process.execPath}", "${failAdapterPath}"]

subscriptions:
  - agentId: qa_gemini
    topic: qa_ready

approvalGates: []
artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const capture = createLogCapture();
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        recoveryIntervalMs: 5_000,
        logger: createDaemonLogger("info", capture.destination)
      });

      try {
        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440353",
            topic: "qa_ready",
            runId: "run-adapter-log-dead-letter-001",
            correlationId: "run-adapter-log-dead-letter-001",
            dedupeKey: "qa_ready:run-adapter-log-dead-letter-001",
            occurredAt: "2026-03-10T06:10:00Z",
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

        const execution = await daemon.runWorkerIteration("worker-log-dead-letter", 60_000);

        assert.ok(execution);
        assert.equal(execution.status, "fatal_error");

        const entries = capture
          .readEntries()
          .filter((entry) => entry.event !== "mcp.started");
        const lifecycleEntries = entries.filter(
          (entry) => entry.event !== "dashboard.started"
        );

        assert.deepEqual(
          entries.map((entry) => entry.event),
          ["dashboard.started", "delivery.claimed", "agent.started", "delivery.dead_lettered"]
        );
        assert.equal(entries[3]?.errorMessage, "Permanent adapter failure.");
        assert.equal(entries[3]?.level, 50);
        assertCorrelationFields(lifecycleEntries, {
          deliveryId: execution.delivery.deliveryId,
          agentId: "qa_gemini",
          runId: "run-adapter-log-dead-letter-001"
        });
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("runWorkerIteration logs dead-lettering for fatal setup errors after claim", async () => {
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

subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready
    requiredArtifacts:
      - path: docs/required.md
        role: input

approvalGates: []
artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const capture = createLogCapture();
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        recoveryIntervalMs: 5_000,
        logger: createDaemonLogger("info", capture.destination)
      });

      try {
        daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440354",
            topic: "implementation_ready",
            runId: "run-adapter-log-setup-fatal-001",
            correlationId: "run-adapter-log-setup-fatal-001",
            dedupeKey: "implementation_ready:run-adapter-log-setup-fatal-001",
            occurredAt: "2026-03-10T06:15:00Z",
            producer: {
              agentId: "planner_codex",
              runtime: "codex"
            },
            payload: {},
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        const execution = await daemon.runWorkerIteration("worker-log-setup-fatal", 60_000);

        assert.ok(execution);
        assert.equal(execution.status, "process_error");
        assert.equal(execution.delivery.status, "dead_letter");

        const entries = capture
          .readEntries()
          .filter((entry) => entry.event !== "mcp.started");
        const lifecycleEntries = entries.filter(
          (entry) => entry.event !== "dashboard.started"
        );

        assert.deepEqual(
          entries.map((entry) => entry.event),
          ["dashboard.started", "delivery.claimed", "delivery.dead_lettered"]
        );
        assert.match(
          String(entries[2]?.errorMessage),
          /Required artifact docs\/required.md is missing/
        );
        assert.equal(entries[2]?.level, 50);
        assertCorrelationFields(lifecycleEntries, {
          deliveryId: execution.delivery.deliveryId,
          agentId: "coder_open_code",
          runId: "run-adapter-log-setup-fatal-001"
        });
      } finally {
        await daemon.stop();
      }
    }
  );
});
