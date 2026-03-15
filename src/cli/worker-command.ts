import * as path from "node:path";

import type { ProcessMonitorCallbacks } from "../adapters/process-runner.js";
import { startDaemon } from "../daemon/index.js";
import type { AdapterWorkerExecutionResult } from "../daemon/adapter-worker.js";
import {
  createDaemonLogger,
  type DaemonLogDestination,
  type DaemonLogLevel
} from "../daemon/logger.js";
import type { WritableTextStream } from "./output.js";
import {
  writeAgentCompletedText,
  writeAgentOutputLine,
  writeAgentStartedText,
  writeWorkerExecutionText,
  writeWorkerIdleText,
  writeWorkerStartedText,
  writeWorkerStoppedText
} from "./output.js";

export interface WorkerCommandIO {
  readonly cwd: string;
  readonly stdout: WritableTextStream;
  readonly stderr: WritableTextStream;
}

const WORKER_HELP_TEXT = `Worker command:
  agent-bus worker [--config path] [--worker-id id] [--lease-duration-ms N] [--poll-interval-ms N] [--retry-delay-ms N] [--log-level level] [--once] [--verbose]
`;

const VALID_LOG_LEVELS = new Set<DaemonLogLevel>([
  "debug",
  "info",
  "warn",
  "error",
  "fatal"
]);

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function readOptionValue(
  args: readonly string[],
  optionName: string
): string | undefined {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
}

function writeError(stream: WritableTextStream, message: string): void {
  stream.write(`${message}\n`);
}

function parseIntegerAtLeast(
  value: string | undefined,
  label: string,
  minimum: number
): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }

  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createStopController() {
  let stopRequested = false;
  let reason = "requested";
  let resolveStop: (() => void) | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  return {
    get requested(): boolean {
      return stopRequested;
    },
    get reason(): string {
      return reason;
    },
    request(nextReason: string): void {
      if (stopRequested) {
        return;
      }

      stopRequested = true;
      reason = nextReason;
      resolveStop?.();
    },
    waitForStop(): Promise<void> {
      return stopPromise;
    }
  };
}

function registerWorkerSignalHandlers(stopController: ReturnType<typeof createStopController>) {
  const handleSignal = (signal: NodeJS.Signals): void => {
    stopController.request(`signal ${signal}`);
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  return () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  };
}

export async function runWorkerCommand(
  args: readonly string[],
  io: WorkerCommandIO
): Promise<number> {
  const optionsWithValues = new Set([
    "--config",
    "--worker-id",
    "--lease-duration-ms",
    "--poll-interval-ms",
    "--retry-delay-ms",
    "--log-level"
  ]);
  const flagsWithoutValues = new Set(["--once", "--verbose"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      break;
    }

    if (!arg.startsWith("--")) {
      writeError(io.stderr, `Unexpected worker argument: ${arg}\n\n${WORKER_HELP_TEXT}`);
      return 1;
    }

    if (optionsWithValues.has(arg)) {
      const optionValue = args[index + 1];

      if (!optionValue || optionValue.startsWith("--")) {
        writeError(
          io.stderr,
          `Worker option ${arg} requires a value.\n\n${WORKER_HELP_TEXT}`
        );
        return 1;
      }

      index += 1;
      continue;
    }

    if (flagsWithoutValues.has(arg)) {
      continue;
    }

    writeError(io.stderr, `Unknown worker option: ${arg}\n\n${WORKER_HELP_TEXT}`);
    return 1;
  }

  const configPath = readOptionValue(args, "--config") ?? "agent-bus.yaml";
  const workerId = readOptionValue(args, "--worker-id") ?? `worker-${process.pid}`;
  const once = hasFlag(args, "--once");
  const verbose = hasFlag(args, "--verbose");
  let leaseDurationMs: number;
  let pollIntervalMs: number;
  let retryDelayMs: number | undefined;
  let logLevel: DaemonLogLevel;

  try {
    leaseDurationMs =
      parseIntegerAtLeast(
        readOptionValue(args, "--lease-duration-ms"),
        "--lease-duration-ms",
        1
      ) ?? 60_000;
    pollIntervalMs =
      parseIntegerAtLeast(
        readOptionValue(args, "--poll-interval-ms"),
        "--poll-interval-ms",
        1
      ) ?? 1_000;
    retryDelayMs =
      parseIntegerAtLeast(
        readOptionValue(args, "--retry-delay-ms"),
        "--retry-delay-ms",
        0
      ) ?? undefined;
    const rawLogLevel = readOptionValue(args, "--log-level") ?? "info";

    if (!VALID_LOG_LEVELS.has(rawLogLevel as DaemonLogLevel)) {
      writeError(
        io.stderr,
        `Invalid --log-level "${rawLogLevel}". Valid: debug, info, warn, error, fatal`
      );
      return 1;
    }

    logLevel = rawLogLevel as DaemonLogLevel;
  } catch (error) {
    writeError(io.stderr, error instanceof Error ? error.message : "Invalid worker command.");
    return 1;
  }

  // When --verbose is set, build monitor callbacks that stream agent output to terminal.
  // Uses a static label "agent" since the agentId is per-delivery and known only at runtime.
  let monitor: ProcessMonitorCallbacks | undefined;

  if (verbose) {
    // Line buffer to avoid splitting multi-byte or mid-line chunks.
    const makeLineBuffer = (source: "stdout" | "stderr") => {
      let buffer = "";

      return (chunk: Buffer): void => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        // All but last element are complete lines.
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          writeAgentOutputLine(io.stdout, "agent", source, line);
        }
      };
    };

    monitor = {
      onStdout: makeLineBuffer("stdout"),
      onStderr: makeLineBuffer("stderr"),
      onStart: (info) => {
        writeAgentStartedText(io.stdout, {
          agentId: "agent",
          pid: info.pid,
          command: info.command
        });
      },
      onComplete: (info) => {
        writeAgentCompletedText(io.stdout, {
          agentId: "agent",
          pid: info.pid,
          exitCode: info.exitCode,
          signal: info.signal,
          elapsedMs: info.elapsedMs
        });
      }
    };
  }

  const logger = createDaemonLogger(logLevel, io.stderr as DaemonLogDestination);

  const daemon = await startDaemon({
    configPath: path.resolve(io.cwd, configPath),
    repositoryRoot: io.cwd,
    registerSignalHandlers: false,
    logger,
    ...(monitor ? { monitor } : {})
  });
  const stopController = createStopController();
  const unregisterSignals = registerWorkerSignalHandlers(stopController);
  let idlePolls = 0;
  let processedDeliveries = 0;

  writeWorkerStartedText(io.stdout, {
    workerId,
    configPath,
    pollIntervalMs,
    leaseDurationMs,
    ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
    once
  });

  try {
    while (!stopController.requested) {
      let result: AdapterWorkerExecutionResult | null;

      try {
        result = await daemon.runWorkerIteration(workerId, leaseDurationMs, retryDelayMs);
      } catch (error) {
        writeError(
          io.stderr,
          error instanceof Error ? error.message : "Worker iteration failed."
        );
        return 1;
      }

      if (result) {
        idlePolls = 0;
        processedDeliveries += 1;
        writeWorkerExecutionText(io.stdout, workerId, result);

        if (once) {
          stopController.request("once");
          break;
        }

        continue;
      }

      idlePolls += 1;

      if (once) {
        stopController.request("once");
        writeWorkerIdleText(io.stdout, workerId);
        break;
      }

      await Promise.race([sleep(pollIntervalMs), stopController.waitForStop()]);
    }

    return 0;
  } finally {
    stopController.request(stopController.reason);
    unregisterSignals();
    await daemon.stop();
    writeWorkerStoppedText(io.stdout, {
      workerId,
      processedDeliveries,
      idlePolls,
      reason: stopController.reason
    });
  }
}
