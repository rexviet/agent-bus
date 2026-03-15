import * as assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { main } from "../../src/cli.js";
import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

interface CapturedRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ParsedDaemonLogLine {
  readonly event?: string;
  readonly level: number;
  readonly timestamp: string;
  readonly deliveryId: string;
  readonly agentId: string;
  readonly runId: string;
}

function createCaptureStream() {
  let output = "";

  return {
    stream: {
      write(chunk: string): boolean {
        output += chunk;
        return true;
      }
    },
    read(): string {
      return output;
    }
  };
}

async function runCli(
  argv: readonly string[],
  cwd: string
): Promise<CapturedRun> {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const exitCode = await main(argv, {
    cwd,
    stdout: stdout.stream,
    stderr: stderr.stream
  });

  return {
    exitCode,
    stdout: stdout.read(),
    stderr: stderr.read()
  };
}

function fixtureAdapterPath(): string {
  return path.resolve(process.cwd(), "test/fixtures/adapters/success-adapter.mjs");
}

function parseDaemonLogLines(stderr: string): ParsedDaemonLogLine[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as ParsedDaemonLogLine);
}

async function withTempRepo(
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-cli-worker-"));
  const configPath = path.join(repositoryRoot, "agent-bus.yaml");
  const successFixturePath = fixtureAdapterPath();

  try {
    await writeFile(
      configPath,
      `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: fixture_worker
    runtime: fixture
    command: ["${process.execPath}", "${successFixturePath}"]

subscriptions:
  - agentId: fixture_worker
    topic: plan_done

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

function readWorkerState(databasePath: string): {
  readonly deliveryStatus: string;
  readonly eventCount: number;
} {
  const database = new DatabaseSync(databasePath);

  try {
    const deliveryRow = database
      .prepare(`SELECT status FROM deliveries LIMIT 1`)
      .get() as { status: string } | undefined;
    const eventRow = database
      .prepare(`SELECT COUNT(*) AS count FROM events`)
      .get() as { count: number };

    if (!deliveryRow) {
      throw new Error(`No delivery rows found in ${databasePath}.`);
    }

    return {
      deliveryStatus: deliveryRow.status,
      eventCount: eventRow.count
    };
  } finally {
    database.close();
  }
}

test("worker --once claims and executes one ready delivery", async () => {
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
          eventId: "550e8400-e29b-41d4-a716-446655440801",
          topic: "plan_done",
          runId: "run-cli-worker",
          correlationId: "run-cli-worker",
          dedupeKey: "plan_done:run-cli-worker",
          occurredAt: "2026-03-11T02:00:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );
    } finally {
      await daemon.stop();
    }

    const result = await runCli(
      ["worker", "--once", "--worker-id", "worker-cli-once"],
      repositoryRoot
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Worker started worker-cli-once/);
    assert.match(result.stdout, /status: success/);
    assert.match(result.stdout, /deliveryStatus: completed/);
    assert.match(result.stdout, /Worker stopped worker-cli-once/);
    assert.match(result.stdout, /reason: once/);

    const databasePath = path.join(
      repositoryRoot,
      ".agent-bus",
      "state",
      "agent-bus.sqlite"
    );
    const workerState = readWorkerState(databasePath);

    assert.equal(workerState.deliveryStatus, "completed");
    assert.equal(workerState.eventCount, 2);

    await access(
      path.join(
        repositoryRoot,
        "workspace",
        "generated",
        "delivery_550e8400-e29b-41d4-a716-446655440801_fixture_worker.md"
      )
    );
  });
});

test("worker --once exits cleanly when no deliveries are ready", async () => {
  await withTempRepo(async (_configPath, repositoryRoot) => {
    const result = await runCli(["worker", "--once"], repositoryRoot);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Worker idle worker-/);
    assert.match(result.stdout, /No deliveries ready\./);
    assert.match(result.stdout, /reason: once/);
  });
});

test("worker validates numeric options and required option values", async () => {
  await withTempRepo(async (_configPath, repositoryRoot) => {
    const invalidLease = await runCli(
      ["worker", "--lease-duration-ms", "0"],
      repositoryRoot
    );
    const missingWorkerId = await runCli(["worker", "--worker-id"], repositoryRoot);
    const invalidLogLevel = await runCli(
      ["worker", "--log-level", "bogus"],
      repositoryRoot
    );
    const missingLogLevelValue = await runCli(
      ["worker", "--log-level", "--once"],
      repositoryRoot
    );

    assert.equal(invalidLease.exitCode, 1);
    assert.match(invalidLease.stderr, /--lease-duration-ms must be an integer >= 1/);

    assert.equal(missingWorkerId.exitCode, 1);
    assert.match(missingWorkerId.stderr, /Worker option --worker-id requires a value/);

    assert.equal(invalidLogLevel.exitCode, 1);
    assert.match(
      invalidLogLevel.stderr,
      /Invalid --log-level "bogus"\. Valid: debug, info, warn, error, fatal/
    );

    assert.equal(missingLogLevelValue.exitCode, 1);
    assert.match(missingLogLevelValue.stderr, /Worker option --log-level requires a value/);
    assert.match(missingLogLevelValue.stderr, /--log-level level/);
  });
});

test("worker emits parseable NDJSON lifecycle logs to stderr", async () => {
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
          eventId: "550e8400-e29b-41d4-a716-446655440802",
          topic: "plan_done",
          runId: "run-cli-worker-logs-001",
          correlationId: "run-cli-worker-logs-001",
          dedupeKey: "plan_done:run-cli-worker-logs-001",
          occurredAt: "2026-03-11T02:05:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );
    } finally {
      await daemon.stop();
    }

    const result = await runCli(
      ["worker", "--once", "--worker-id", "worker-cli-logs", "--log-level", "debug"],
      repositoryRoot
    );

    assert.equal(result.exitCode, 0);

    const logLines = parseDaemonLogLines(result.stderr);

    assert.ok(logLines.length >= 3, `expected structured log lines, got: ${result.stderr}`);
    assert.ok(logLines.some((line) => line.event === "delivery.claimed"));

    for (const line of logLines) {
      assert.equal(typeof line.level, "number");
      assert.equal(typeof line.timestamp, "string");
      assert.equal(typeof line.deliveryId, "string");
      assert.equal(typeof line.agentId, "string");
      assert.equal(typeof line.runId, "string");
    }
  });
});

test("worker defaults log level to info when --log-level is omitted", async () => {
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
          eventId: "550e8400-e29b-41d4-a716-446655440803",
          topic: "plan_done",
          runId: "run-cli-worker-logs-default-001",
          correlationId: "run-cli-worker-logs-default-001",
          dedupeKey: "plan_done:run-cli-worker-logs-default-001",
          occurredAt: "2026-03-11T02:10:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );
    } finally {
      await daemon.stop();
    }

    const result = await runCli(
      ["worker", "--once", "--worker-id", "worker-cli-default-log-level"],
      repositoryRoot
    );

    assert.equal(result.exitCode, 0);

    const logLines = parseDaemonLogLines(result.stderr);

    assert.ok(logLines.length >= 3, `expected info-level logs by default, got: ${result.stderr}`);
    assert.ok(logLines.every((line) => line.level >= 30));
  });
});
