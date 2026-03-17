import * as assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

import { main } from "../../src/cli.js";
import { runWorkerCommand } from "../../src/cli/worker-command.js";
import { createAdapterWorker } from "../../src/daemon/adapter-worker.js";
import type { AdapterWorkerExecutionResult } from "../../src/daemon/adapter-worker.js";
import { startDaemon } from "../../src/daemon/index.js";
import type { DaemonLogger } from "../../src/daemon/logger.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

interface CapturedRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface SpawnedWorkerHandle {
  readonly child: ChildProcess;
  readonly readStdout: () => string;
  readonly readStderr: () => string;
  readonly exit: Promise<CapturedRun>;
}

interface ParsedDaemonLogLine {
  readonly event?: string;
  readonly level: number;
  readonly timestamp: string;
  readonly deliveryId?: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly workerId?: string;
  readonly mcpUrl?: string;
  readonly drainTimeoutMs?: number;
  readonly inFlightCount?: number;
}

const DIST_CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");
const SUCCESS_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/success-adapter.mjs"
);
const TIMEOUT_GROUP_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/timeout-group-fixture.mjs"
);

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

function spawnWorkerCli(
  args: readonly string[],
  cwd: string
): SpawnedWorkerHandle {
  const child = spawn(
    process.execPath,
    ["--experimental-sqlite", DIST_CLI_PATH, "worker", ...args],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exit = new Promise<CapturedRun>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });

  return {
    child,
    readStdout: () => stdout,
    readStderr: () => stderr,
    exit
  };
}

function defaultManifestText(): string {
  return `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: fixture_worker
    runtime: fixture
    command: ["${process.execPath}", "${SUCCESS_FIXTURE_PATH}"]

subscriptions:
  - agentId: fixture_worker
    topic: plan_done

approvalGates: []
artifactConventions: []
`;
}

async function withTempRepo(
  callback: (configPath: string, repositoryRoot: string) => Promise<void>,
  manifestText = defaultManifestText()
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-cli-worker-"));
  const configPath = path.join(repositoryRoot, "agent-bus.yaml");

  try {
    await writeFile(configPath, manifestText, "utf8");
    await callback(configPath, repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

function databasePathFor(repositoryRoot: string): string {
  return path.join(repositoryRoot, ".agent-bus", "state", "agent-bus.sqlite");
}

function readDeliveryStatuses(databasePath: string): string[] {
  const database = new DatabaseSync(databasePath);

  try {
    const rows = database
      .prepare(`SELECT status FROM deliveries ORDER BY delivery_id ASC`)
      .all() as Array<{ status: string }>;

    return rows.map((row) => row.status);
  } finally {
    database.close();
  }
}

function readEventCount(databasePath: string): number {
  const database = new DatabaseSync(databasePath);

  try {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM events`)
      .get() as { count: number };

    return row.count;
  } finally {
    database.close();
  }
}

async function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await sleep(25);
  }

  assert.fail(`Timed out waiting for ${description}.`);
}

async function publishPlanDoneEvents(
  configPath: string,
  repositoryRoot: string,
  events: ReadonlyArray<{
    readonly eventId: string;
    readonly runId: string;
    readonly dedupeKey: string;
    readonly occurredAt: string;
    readonly payload?: Record<string, unknown>;
  }>
): Promise<void> {
  const daemon = await startDaemon({
    configPath,
    repositoryRoot,
    registerSignalHandlers: false,
    recoveryIntervalMs: 5_000
  });

  try {
    for (const event of events) {
      daemon.publish(
        parseEventEnvelope({
          eventId: event.eventId,
          topic: "plan_done",
          runId: event.runId,
          correlationId: event.runId,
          dedupeKey: event.dedupeKey,
          occurredAt: event.occurredAt,
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: event.payload ?? {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );
    }
  } finally {
    await daemon.stop();
  }
}

function parseDaemonLogLines(stderr: string): ParsedDaemonLogLine[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as ParsedDaemonLogLine);
}

function buildDelayedSuccessManifest(): string {
  return `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: fixture_worker
    runtime: fixture
    command: ["${process.execPath}", "${SUCCESS_FIXTURE_PATH}"]

subscriptions:
  - agentId: fixture_worker
    topic: plan_done

approvalGates: []
artifactConventions: []
`;
}

function buildTimeoutGroupManifest(): string {
  return `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: fixture_worker
    runtime: fixture
    command: ["${process.execPath}", "${TIMEOUT_GROUP_FIXTURE_PATH}"]

subscriptions:
  - agentId: fixture_worker
    topic: plan_done

approvalGates: []
artifactConventions: []
`;
}

async function stopWorker(worker: SpawnedWorkerHandle): Promise<CapturedRun> {
  if (!worker.child.killed) {
    worker.child.kill("SIGTERM");
  }

  return worker.exit;
}

test("worker --once claims and executes one ready delivery", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    await publishPlanDoneEvents(configPath, repositoryRoot, [
      {
        eventId: "550e8400-e29b-41d4-a716-446655440801",
        runId: "run-cli-worker",
        dedupeKey: "plan_done:run-cli-worker",
        occurredAt: "2026-03-11T02:00:00Z"
      }
    ]);

    const result = await runCli(
      ["worker", "--once", "--worker-id", "worker-cli-once"],
      repositoryRoot
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Worker started worker-cli-once/);
    assert.match(result.stdout, /concurrency: 1/);
    assert.match(result.stdout, /drainTimeoutMs: 30000/);
    assert.match(result.stdout, /mcp: http:\/\/127\.0\.0\.1:\d+\/mcp/);
    assert.match(result.stdout, /status: success/);
    assert.match(result.stdout, /deliveryStatus: completed/);
    assert.match(result.stdout, /Worker stopped worker-cli-once/);
    assert.match(result.stdout, /reason: once/);

    const databasePath = databasePathFor(repositoryRoot);
    const deliveryStatuses = readDeliveryStatuses(databasePath);

    assert.deepEqual(deliveryStatuses, ["completed"]);
    assert.equal(readEventCount(databasePath), 2);

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
    const invalidConcurrency = await runCli(
      ["worker", "--concurrency", "0"],
      repositoryRoot
    );
    const invalidDrainTimeout = await runCli(
      ["worker", "--drain-timeout-ms", "-1"],
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
    const invalidMcpPort = await runCli(
      ["worker", "--mcp-port", "0"],
      repositoryRoot
    );

    assert.equal(invalidLease.exitCode, 1);
    assert.match(invalidLease.stderr, /--lease-duration-ms must be an integer >= 1/);

    assert.equal(invalidConcurrency.exitCode, 1);
    assert.match(invalidConcurrency.stderr, /--concurrency must be an integer >= 1/);

    assert.equal(invalidDrainTimeout.exitCode, 1);
    assert.match(
      invalidDrainTimeout.stderr,
      /--drain-timeout-ms must be an integer >= 0/
    );

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

    assert.equal(invalidMcpPort.exitCode, 1);
    assert.match(invalidMcpPort.stderr, /--mcp-port must be an integer >= 1/);
  });
});

test("worker emits parseable NDJSON lifecycle logs to stderr", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    await publishPlanDoneEvents(configPath, repositoryRoot, [
      {
        eventId: "550e8400-e29b-41d4-a716-446655440802",
        runId: "run-cli-worker-logs-001",
        dedupeKey: "plan_done:run-cli-worker-logs-001",
        occurredAt: "2026-03-11T02:05:00Z"
      }
    ]);

    const result = await runCli(
      ["worker", "--once", "--worker-id", "worker-cli-logs", "--log-level", "debug"],
      repositoryRoot
    );

    assert.equal(result.exitCode, 0);

    const logLines = parseDaemonLogLines(result.stderr);

    assert.ok(logLines.length >= 3, `expected structured log lines, got: ${result.stderr}`);
    assert.ok(logLines.some((line) => line.event === "delivery.claimed"));
    assert.ok(logLines.some((line) => line.event === "mcp.started"));
    assert.ok(
      logLines.some((line) => line.event === "mcp.started" && typeof line.mcpUrl === "string")
    );

    for (const line of logLines) {
      assert.equal(typeof line.level, "number");
      assert.equal(typeof line.timestamp, "string");
      if (line.deliveryId !== undefined) {
        assert.equal(typeof line.deliveryId, "string");
      }
      if (line.agentId !== undefined) {
        assert.equal(typeof line.agentId, "string");
      }
      if (line.runId !== undefined) {
        assert.equal(typeof line.runId, "string");
      }
      if (line.workerId !== undefined) {
        assert.equal(typeof line.workerId, "string");
      }
    }
  });
});

test("worker forwards --mcp-port and prints startup mcp URL", async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  let capturedMcpPort: number | undefined;

  const exitCode = await runWorkerCommand(
    ["--once", "--mcp-port", "12345", "--worker-id", "worker-mcp-port"],
    {
      cwd: process.cwd(),
      stdout: stdout.stream,
      stderr: stderr.stream
    },
    {
      startDaemon: async (options) => {
        capturedMcpPort = options.mcpPort;

        return ({
          mcpUrl: "http://127.0.0.1:12345/mcp",
          runWorkerIteration() {
            return Promise.resolve(null);
          },
          getInFlightDeliveryCount() {
            return 0;
          },
          forceKillInFlight() {
            // no-op
          },
          async stop() {
            // no-op
          }
        }) as never;
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(capturedMcpPort, 12345);
  assert.match(stdout.read(), /mcp: http:\/\/127\.0\.0\.1:12345\/mcp/);
});

test("worker defaults log level to info when --log-level is omitted", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    await publishPlanDoneEvents(configPath, repositoryRoot, [
      {
        eventId: "550e8400-e29b-41d4-a716-446655440803",
        runId: "run-cli-worker-logs-default-001",
        dedupeKey: "plan_done:run-cli-worker-logs-default-001",
        occurredAt: "2026-03-11T02:10:00Z"
      }
    ]);

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

test("worker keeps other slots running when one slot iteration fails", async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const seenWorkerIds: string[] = [];
  let stopCalls = 0;
  let successfulDeliveryProcessed = false;

  const successResult: AdapterWorkerExecutionResult = {
    status: "success",
    delivery: {
      deliveryId: "delivery-success-001",
      eventId: "event-success-001",
      agentId: "fixture_worker",
      topic: "plan_done",
      status: "completed",
      availableAt: "2026-03-15T12:00:00Z",
      attemptCount: 1,
      maxAttempts: 3,
      replayCount: 0,
      createdAt: "2026-03-15T12:00:00Z",
      updatedAt: "2026-03-15T12:00:01Z",
      leaseToken: "lease-token-success"
    },
    workPackagePath: "/tmp/work-package.json",
    resultFilePath: "/tmp/result.json",
    logFilePath: "/tmp/log.txt",
    emittedEvents: []
  };

  const exitCode = await runWorkerCommand(
    ["--worker-id", "worker-isolation", "--concurrency", "2", "--poll-interval-ms", "1"],
    {
      cwd: process.cwd(),
      stdout: stdout.stream,
      stderr: stderr.stream
    },
    {
      createDaemonLogger: () =>
        ({
          info() {
            // no-op
          },
          warn() {
            // no-op
          }
        }) as unknown as DaemonLogger,
      startDaemon: async () =>
        ({
          mcpUrl: "http://127.0.0.1:9999/mcp",
          runWorkerIteration(workerId: string) {
            seenWorkerIds.push(workerId);

            if (workerId.endsWith("/0")) {
              return Promise.reject(new Error("slot failed"));
            }

            if (!successfulDeliveryProcessed) {
              successfulDeliveryProcessed = true;
              return new Promise<AdapterWorkerExecutionResult>((resolve) => {
                setTimeout(() => {
                  process.emit("SIGTERM", "SIGTERM");
                  resolve(successResult);
                }, 10);
              });
            }

            return Promise.resolve(null);
          },
          getInFlightDeliveryCount() {
            return 0;
          },
          forceKillInFlight() {
            // no-op
          },
          async stop() {
            stopCalls += 1;
          }
        }) as never
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stopCalls, 1);
  assert.ok(seenWorkerIds.some((workerId) => workerId.endsWith("/0")));
  assert.ok(seenWorkerIds.some((workerId) => workerId.endsWith("/1")));
  assert.match(stdout.read(), /Worker result worker-isolation\/1/);
  assert.match(stdout.read(), /reason: signal SIGTERM/);
  assert.match(stderr.read(), /worker-isolation\/0: slot failed/);
});

test("worker runs deliveries concurrently when --concurrency is greater than one", async () => {
  await withTempRepo(
    async (configPath, repositoryRoot) => {
      await publishPlanDoneEvents(configPath, repositoryRoot, [
        {
          eventId: "550e8400-e29b-41d4-a716-446655440804",
          runId: "run-cli-worker-concurrent-001",
          dedupeKey: "plan_done:run-cli-worker-concurrent-001",
          occurredAt: "2026-03-11T02:15:00Z",
          payload: { delayMs: 500 }
        },
        {
          eventId: "550e8400-e29b-41d4-a716-446655440805",
          runId: "run-cli-worker-concurrent-002",
          dedupeKey: "plan_done:run-cli-worker-concurrent-002",
          occurredAt: "2026-03-11T02:15:01Z",
          payload: { delayMs: 500 }
        }
      ]);

      const worker = spawnWorkerCli(
        ["--worker-id", "worker-concurrent", "--concurrency", "2", "--log-level", "debug"],
        repositoryRoot
      );

      try {
        const databasePath = databasePathFor(repositoryRoot);
        await waitForCondition(
          () => readDeliveryStatuses(databasePath).every((status) => status === "completed"),
          "both concurrent deliveries to complete",
          // Includes daemon startup + MCP startup overhead on CI runners.
          8_000
        );

        const result = await stopWorker(worker);
        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /concurrency: 2/);
        assert.match(result.stdout, /drainTimeoutMs: 30000/);

        const startedLogs = parseDaemonLogLines(result.stderr).filter(
          (line) => line.event === "agent.started"
        );

        assert.ok(startedLogs.length >= 2, `expected at least 2 agent.started logs, got: ${result.stderr}`);
        assert.ok(startedLogs.some((line) => line.workerId?.endsWith("/0")));
        assert.ok(startedLogs.some((line) => line.workerId?.endsWith("/1")));

        const startedAt = startedLogs
          .slice(0, 2)
          .map((line) => new Date(line.timestamp).getTime())
          .sort((left, right) => left - right);
        const startGapMs = startedAt[1]! - startedAt[0]!;

        assert.ok(
          startGapMs < 300,
          `expected concurrent agent starts, observed ${startGapMs}ms gap`
        );
      } finally {
        if (!worker.child.killed) {
          worker.child.kill("SIGTERM");
        }
        await worker.exit.catch(() => undefined);
      }
    },
    buildDelayedSuccessManifest()
  );
});

test("worker defaults to sequential execution when --concurrency is omitted", async () => {
  await withTempRepo(
    async (configPath, repositoryRoot) => {
      await publishPlanDoneEvents(configPath, repositoryRoot, [
        {
          eventId: "550e8400-e29b-41d4-a716-446655440806",
          runId: "run-cli-worker-sequential-001",
          dedupeKey: "plan_done:run-cli-worker-sequential-001",
          occurredAt: "2026-03-11T02:20:00Z",
          payload: { delayMs: 400 }
        },
        {
          eventId: "550e8400-e29b-41d4-a716-446655440807",
          runId: "run-cli-worker-sequential-002",
          dedupeKey: "plan_done:run-cli-worker-sequential-002",
          occurredAt: "2026-03-11T02:20:01Z",
          payload: { delayMs: 400 }
        }
      ]);

      const worker = spawnWorkerCli(
        ["--worker-id", "worker-sequential", "--log-level", "debug"],
        repositoryRoot
      );

      try {
        const databasePath = databasePathFor(repositoryRoot);
        await waitForCondition(
          () => readDeliveryStatuses(databasePath).every((status) => status === "completed"),
          "both sequential deliveries to complete",
          // CI jitter can delay claim/start transitions for this sequential test.
          12_000
        );

        const result = await stopWorker(worker);
        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /concurrency: 1/);

        const startedLogs = parseDaemonLogLines(result.stderr).filter(
          (line) => line.event === "agent.started"
        );

        assert.ok(startedLogs.length >= 2, `expected at least 2 agent.started logs, got: ${result.stderr}`);

        const startedAt = startedLogs
          .slice(0, 2)
          .map((line) => new Date(line.timestamp).getTime())
          .sort((left, right) => left - right);
        const startGapMs = startedAt[1]! - startedAt[0]!;

        assert.ok(
          startGapMs >= 300,
          `expected sequential agent starts, observed only ${startGapMs}ms gap`
        );
      } finally {
        if (!worker.child.killed) {
          worker.child.kill("SIGTERM");
        }
        await worker.exit.catch(() => undefined);
      }
    },
    buildDelayedSuccessManifest()
  );
});

test("worker drains in-flight deliveries on SIGTERM before exit", async () => {
  await withTempRepo(
    async (configPath, repositoryRoot) => {
      await publishPlanDoneEvents(configPath, repositoryRoot, [
        {
          eventId: "550e8400-e29b-41d4-a716-446655440808",
          runId: "run-cli-worker-drain-001",
          dedupeKey: "plan_done:run-cli-worker-drain-001",
          occurredAt: "2026-03-11T02:25:00Z",
          payload: { delayMs: 350 }
        }
      ]);

      const worker = spawnWorkerCli(
        ["--worker-id", "worker-drain", "--log-level", "debug", "--verbose"],
        repositoryRoot
      );

      try {
        await waitForCondition(
          () => worker.readStdout().includes("Agent started fixture_worker"),
          "agent to start before drain signal"
        );

        const result = await stopWorker(worker);
        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /reason: signal SIGTERM/);
        assert.match(result.stdout, /drainedDeliveries: 1/);
        assert.doesNotMatch(result.stderr, /"event":"drain.timeout"/);

        const deliveryStatuses = readDeliveryStatuses(databasePathFor(repositoryRoot));
        assert.deepEqual(deliveryStatuses, ["completed"]);
      } finally {
        if (!worker.child.killed) {
          worker.child.kill("SIGTERM");
        }
        await worker.exit.catch(() => undefined);
      }
    },
    buildDelayedSuccessManifest()
  );
});

test("worker force-kills in-flight deliveries when drain timeout expires", async () => {
  await withTempRepo(
    async (configPath, repositoryRoot) => {
      await publishPlanDoneEvents(configPath, repositoryRoot, [
        {
          eventId: "550e8400-e29b-41d4-a716-446655440809",
          runId: "run-cli-worker-drain-timeout-001",
          dedupeKey: "plan_done:run-cli-worker-drain-timeout-001",
          occurredAt: "2026-03-11T02:30:00Z"
        }
      ]);

      const worker = spawnWorkerCli(
        [
          "--worker-id",
          "worker-drain-timeout",
          "--drain-timeout-ms",
          "100",
          "--log-level",
          "debug",
          "--verbose"
        ],
        repositoryRoot
      );

      try {
        await waitForCondition(
          () => worker.readStdout().includes("Agent started fixture_worker"),
          "agent to start before drain timeout signal"
        );

        const startedAt = Date.now();
        const result = await stopWorker(worker);
        const elapsedMs = Date.now() - startedAt;

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /reason: signal SIGTERM/);
        assert.match(result.stdout, /drainedDeliveries: 1/);
        assert.match(result.stderr, /"event":"drain.timeout"/);
        assert.ok(
          elapsedMs >= 4_500,
          `expected SIGKILL grace period before exit, observed ${elapsedMs}ms`
        );

        const deliveryStatuses = readDeliveryStatuses(databasePathFor(repositoryRoot));
        assert.deepEqual(deliveryStatuses, ["retry_scheduled"]);
      } finally {
        if (!worker.child.killed) {
          worker.child.kill("SIGTERM");
        }
        await worker.exit.catch(() => undefined);
      }
    },
    buildTimeoutGroupManifest()
  );
});

test("adapter worker logs lease conflicts at warn level and returns null", async () => {
  const warnings: Array<{ readonly bindings: Record<string, unknown>; readonly message: string }> =
    [];
  const logger = {
    warn(bindings: Record<string, unknown>, message: string) {
      warnings.push({ bindings, message });
    }
  } as unknown as DaemonLogger;

  const worker = createAdapterWorker({
    database: {} as DatabaseSync,
    manifest: {
      version: 1,
      workspace: {
        artifactsDir: "workspace",
        stateDir: ".agent-bus/state",
        logsDir: ".agent-bus/logs"
      },
      agents: [],
      subscriptions: [],
      approvalGates: [],
      artifactConventions: []
    },
    layout: {
      repositoryRoot: process.cwd(),
      workspaceDir: process.cwd(),
      internalDir: process.cwd(),
      stateDir: process.cwd(),
      logsDir: process.cwd()
    },
    runStore: {} as never,
    eventStore: {} as never,
    deliveryStore: {} as never,
    deliveryService: {
      claim() {
        throw new Error("Failed to claim delivery delivery-conflict-001.");
      },
      acknowledge() {
        throw new Error("unreachable");
      },
      fail() {
        throw new Error("unreachable");
      },
      deadLetter() {
        throw new Error("unreachable");
      }
    },
    dispatcher: {} as never,
    logger
  });

  const result = await worker.runIteration({
    workerId: "worker-conflict/0",
    leaseDurationMs: 5_000
  });

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.bindings.event, "lease.conflict");
  assert.equal(warnings[0]?.bindings.deliveryId, "delivery-conflict-001");
  assert.equal(warnings[0]?.bindings.workerId, "worker-conflict/0");
  assert.match(warnings[0]?.message ?? "", /Lease conflict detected/);
});
