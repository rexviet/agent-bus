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
  agent-bus worker [--config path] [--worker-id id] [--lease-duration-ms N] [--poll-interval-ms N] [--retry-delay-ms N] [--concurrency N] [--drain-timeout-ms N] [--log-level level] [--once] [--verbose]
`;

interface RunWorkerCommandDependencies {
  readonly startDaemon?: typeof startDaemon;
  readonly createDaemonLogger?: typeof createDaemonLogger;
}

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

export function createMutex(): {
  run<T>(fn: () => Promise<T> | T): Promise<T>;
} {
  let chain: Promise<void> = Promise.resolve();

  return {
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      const result = chain.then(fn);
      chain = result.then(
        () => undefined,
        () => undefined
      );

      return result;
    }
  };
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

export function createVerboseMonitorFactory(
  stream: WritableTextStream
): (agentId: string) => ProcessMonitorCallbacks {
  return (agentId: string): ProcessMonitorCallbacks => {
    const makeLineBuffer = (source: "stdout" | "stderr") => {
      let buffer = "";

      return (chunk: Buffer): void => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          writeAgentOutputLine(stream, agentId, source, line);
        }
      };
    };

    return {
      onStdout: makeLineBuffer("stdout"),
      onStderr: makeLineBuffer("stderr"),
      onStart: (info) => {
        writeAgentStartedText(stream, {
          agentId,
          pid: info.pid,
          command: info.command
        });
      },
      onComplete: (info) => {
        writeAgentCompletedText(stream, {
          agentId,
          pid: info.pid,
          exitCode: info.exitCode,
          signal: info.signal,
          elapsedMs: info.elapsedMs
        });
      }
    };
  };
}

export async function runWorkerCommand(
  args: readonly string[],
  io: WorkerCommandIO,
  dependencies: RunWorkerCommandDependencies = {}
): Promise<number> {
  const startDaemonImpl = dependencies.startDaemon ?? startDaemon;
  const createDaemonLoggerImpl =
    dependencies.createDaemonLogger ?? createDaemonLogger;
  const optionsWithValues = new Set([
    "--config",
    "--worker-id",
    "--lease-duration-ms",
    "--poll-interval-ms",
    "--retry-delay-ms",
    "--concurrency",
    "--drain-timeout-ms",
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
  let concurrency: number;
  let drainTimeoutMs: number;
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
    concurrency =
      parseIntegerAtLeast(
        readOptionValue(args, "--concurrency"),
        "--concurrency",
        1
      ) ?? 1;
    drainTimeoutMs =
      parseIntegerAtLeast(
        readOptionValue(args, "--drain-timeout-ms"),
        "--drain-timeout-ms",
        0
      ) ?? 30_000;
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

  const verboseMonitorFactory = verbose ? createVerboseMonitorFactory(io.stdout) : undefined;
  const logger = createDaemonLoggerImpl(logLevel, io.stderr as DaemonLogDestination);
  const daemon = await startDaemonImpl({
    configPath: path.resolve(io.cwd, configPath),
    repositoryRoot: io.cwd,
    registerSignalHandlers: false,
    logger,
    ...(verboseMonitorFactory ? { verboseMonitorFactory } : {})
  });
  const stopController = createStopController();
  const unregisterSignals = registerWorkerSignalHandlers(stopController);
  const claimMutex = createMutex();
  let idlePolls = 0;
  let processedDeliveries = 0;
  let drainedDeliveries = 0;
  let encounteredError = false;
  let inFlightIterations = 0;

  writeWorkerStartedText(io.stdout, {
    workerId,
    configPath,
    pollIntervalMs,
    leaseDurationMs,
    concurrency,
    drainTimeoutMs,
    ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
    once
  });

  try {
    const waitForNextPoll = () =>
      Promise.race([sleep(pollIntervalMs), stopController.waitForStop()]);
    // --once processes exactly one delivery, so only one slot is needed
    // regardless of the configured concurrency. The startup banner still
    // shows the configured concurrency value for operator awareness.
    const slotCount = once ? 1 : concurrency;
    type IterationStart =
      | { readonly started: false }
      | {
          readonly started: true;
          readonly promise: Promise<AdapterWorkerExecutionResult | null>;
        };

    async function runSlot(slotIndex: number): Promise<void> {
      const slotWorkerId = `${workerId}/${slotIndex}`;

      while (!stopController.requested) {
        // The mutex serializes the claim start. daemon.runWorkerIteration()
        // calls deliveryService.claim() synchronously before its first await
        // (adapter-worker.ts), so the claim completes inside the mutex window.
        // The returned promise is awaited outside the mutex, allowing parallel
        // agent execution. If runWorkerIteration's claim is ever made async,
        // this mutex guarantee breaks.
        const iterationStart = await claimMutex.run<IterationStart>(() => {
          if (stopController.requested || inFlightIterations >= concurrency) {
            return { started: false };
          }

          inFlightIterations += 1;

          return {
            started: true,
            promise: daemon.runWorkerIteration(slotWorkerId, leaseDurationMs, retryDelayMs)
          };
        });

        if (!iterationStart.started) {
          await waitForNextPoll();
          continue;
        }

        let result: AdapterWorkerExecutionResult | null;

        try {
          result = await iterationStart.promise;
        } catch (error) {
          encounteredError = true;
          writeError(
            io.stderr,
            `${slotWorkerId}: ${error instanceof Error ? error.message : "Worker iteration failed."}`
          );
          break;
        } finally {
          inFlightIterations -= 1;
        }

        if (result) {
          idlePolls = 0;
          processedDeliveries += 1;
          writeWorkerExecutionText(io.stdout, slotWorkerId, result);

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

        await waitForNextPoll();
      }
    }

    const slotPromises = Array.from({ length: slotCount }, (_, index) => runSlot(index));
    const slotsSettled = Promise.allSettled(slotPromises);
    const drainWatcher = stopController.waitForStop().then(async () => {
      drainedDeliveries = daemon.getInFlightDeliveryCount();

      if (drainedDeliveries === 0) {
        return;
      }

      const drainTimedOut = await new Promise<boolean>((resolve) => {
        let resolved = false;
        const timeoutHandle = setTimeout(() => {
          if (resolved) {
            return;
          }

          resolved = true;
          resolve(true);
        }, drainTimeoutMs);

        slotsSettled.then(() => {
          if (resolved) {
            return;
          }

          resolved = true;
          clearTimeout(timeoutHandle);
          resolve(false);
        });
      });

      if (!drainTimedOut) {
        return;
      }

      const remainingDeliveries = daemon.getInFlightDeliveryCount();

      if (remainingDeliveries === 0) {
        return;
      }

      logger.warn({
        event: "drain.timeout",
        workerId,
        inFlightCount: remainingDeliveries,
        drainTimeoutMs
      });
      daemon.forceKillInFlight();
    });

    await slotsSettled;
    await drainWatcher;

    return encounteredError ? 1 : 0;
  } finally {
    stopController.request(stopController.reason);
    unregisterSignals();
    await daemon.stop();
    writeWorkerStoppedText(io.stdout, {
      workerId,
      processedDeliveries,
      drainedDeliveries,
      idlePolls,
      reason: stopController.reason
    });
  }
}
