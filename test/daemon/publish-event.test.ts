import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { startDaemon } from "../../src/daemon/index.js";
import {
  createDaemonLogger,
  type DaemonLogDestination
} from "../../src/daemon/logger.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";
import { EventSchemaValidationError } from "../../src/domain/schema-error.js";
import { openSqliteDatabase } from "../../src/storage/sqlite-client.js";

async function withTempRepo(
  manifestText: string,
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-publish-event-"));
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

test("publish logs and persists invalid payloads in warn mode", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: qa_gemini
    runtime: gemini
    command: [gemini]

subscriptions:
  - agentId: qa_gemini
    topic: plan_done

schemas:
  plan_done:
    enforcement: warn
    schema:
      type: object
      properties:
        version:
          type: integer
      required:
        - version
      additionalProperties: false

approvalGates: []
artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const logs = createLogCapture();
      const logger = createDaemonLogger("debug", logs.destination);
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        runRecoveryScanOnStart: false,
        startRecoveryScan: false,
        logger
      });

      try {
        const event = daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440901",
            topic: "plan_done",
            runId: "run-schema-warn-001",
            correlationId: "run-schema-warn-001",
            dedupeKey: "plan_done:run-schema-warn-001",
            occurredAt: "2026-03-17T14:55:00Z",
            producer: {
              agentId: "ba_codex",
              runtime: "codex"
            },
            payload: {
              version: "v1"
            },
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        assert.equal(event.approvalStatus, "not_required");
        assert.equal(daemon.listDeliveriesForEvent(event.eventId).length, 1);

        const validationLog = logs
          .readEntries()
          .find(
            (entry) =>
              entry.event === "schema.validation_failed" && entry.enforcement === "warn"
          );

        assert.ok(validationLog);
        assert.equal(validationLog?.runId, "run-schema-warn-001");
        assert.equal(validationLog?.agentId, "ba_codex");
        assert.equal(validationLog?.topic, "plan_done");
        assert.equal(validationLog?.schemaSource, "manifest");
        assert.match(String(validationLog?.issue ?? ""), /must be integer/);
        assert.ok(String(validationLog?.issue ?? "").length <= 100);
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("publish throws EventSchemaValidationError in reject mode and does not persist", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: qa_gemini
    runtime: gemini
    command: [gemini]

subscriptions:
  - agentId: qa_gemini
    topic: plan_done

schemas:
  plan_done:
    enforcement: reject
    schema:
      type: object
      properties:
        version:
          type: integer
      required:
        - version
      additionalProperties: false

approvalGates: []
artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        runRecoveryScanOnStart: false,
        startRecoveryScan: false
      });

      try {
        assert.throws(
          () =>
            daemon.publish(
              parseEventEnvelope({
                eventId: "550e8400-e29b-41d4-a716-446655440902",
                topic: "plan_done",
                runId: "run-schema-reject-001",
                correlationId: "run-schema-reject-001",
                dedupeKey: "plan_done:run-schema-reject-001",
                occurredAt: "2026-03-17T14:56:00Z",
                producer: {
                  agentId: "ba_codex",
                  runtime: "codex"
                },
                payload: {
                  version: "v1"
                },
                payloadMetadata: {},
                artifactRefs: []
              })
            ),
          (error: unknown) =>
            error instanceof EventSchemaValidationError &&
            error.topic === "plan_done" &&
            error.code === "SCHEMA_VALIDATION_FAILED"
        );

        const database = openSqliteDatabase({ databasePath: daemon.databasePath });

        try {
          const counts = database
            .prepare(
              "SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM deliveries) AS deliveries, (SELECT COUNT(*) FROM runs) AS runs"
            )
            .get() as {
              readonly events: number;
              readonly deliveries: number;
              readonly runs: number;
            };

          assert.equal(counts.events, 0);
          assert.equal(counts.deliveries, 0);
          assert.equal(counts.runs, 0);
        } finally {
          database.close();
        }
      } finally {
        await daemon.stop();
      }
    }
  );
});

test("publish bypasses validation when topic has no schema", async () => {
  await withTempRepo(
    `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: qa_gemini
    runtime: gemini
    command: [gemini]

subscriptions:
  - agentId: qa_gemini
    topic: plan_done

approvalGates: []
artifactConventions: []
`,
    async (configPath, repositoryRoot) => {
      const daemon = await startDaemon({
        configPath,
        repositoryRoot,
        registerSignalHandlers: false,
        runRecoveryScanOnStart: false,
        startRecoveryScan: false
      });

      try {
        const event = daemon.publish(
          parseEventEnvelope({
            eventId: "550e8400-e29b-41d4-a716-446655440903",
            topic: "plan_done",
            runId: "run-schema-none-001",
            correlationId: "run-schema-none-001",
            dedupeKey: "plan_done:run-schema-none-001",
            occurredAt: "2026-03-17T14:57:00Z",
            producer: {
              agentId: "ba_codex",
              runtime: "codex"
            },
            payload: {
              arbitrary: ["value", 123]
            },
            payloadMetadata: {},
            artifactRefs: []
          })
        );

        assert.equal(event.approvalStatus, "not_required");
        assert.equal(daemon.listDeliveriesForEvent(event.eventId).length, 1);
      } finally {
        await daemon.stop();
      }
    }
  );
});
