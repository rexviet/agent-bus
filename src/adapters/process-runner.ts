import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

const SIGKILL_GRACE_MS = 5_000;

import {
  type AdapterResultEnvelope,
  type AdapterWorkPackage,
  parseAdapterResultEnvelope
} from "./contract.js";

export interface PreparedAdapterCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
}

export interface MaterializeAdapterRunInput {
  readonly runDirectory: string;
  readonly logFilePath: string;
  readonly resultFilePath: string;
  readonly workPackage: AdapterWorkPackage;
}

export interface MaterializedAdapterRun {
  readonly runDirectory: string;
  readonly workPackagePath: string;
  readonly logFilePath: string;
  readonly resultFilePath: string;
}

export interface ProcessMonitorCallbacks {
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
  readonly onStart?: (info: { pid: number; command: string; startedAt: Date }) => void;
  readonly onComplete?: (info: {
    pid: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    elapsedMs: number;
  }) => void;
  readonly timeoutMs?: number;
}

export interface RunPreparedAdapterCommandInput {
  readonly materializedRun: MaterializedAdapterRun;
  readonly execution: PreparedAdapterCommand;
  readonly monitor?: ProcessMonitorCallbacks;
}

export interface AdapterProcessRunResult {
  readonly workPackagePath: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly result?: AdapterResultEnvelope;
}

export async function materializeAdapterRun(
  input: MaterializeAdapterRunInput
): Promise<MaterializedAdapterRun> {
  const runDirectory = path.resolve(input.runDirectory);
  const workPackagePath = path.join(runDirectory, "work-package.json");
  const resultFilePath = path.resolve(input.resultFilePath);
  const logFilePath = path.resolve(input.logFilePath);

  await mkdir(runDirectory, { recursive: true });
  await mkdir(path.dirname(logFilePath), { recursive: true });
  await mkdir(path.dirname(resultFilePath), { recursive: true });
  await rm(resultFilePath, { force: true });
  await writeFile(workPackagePath, `${JSON.stringify(input.workPackage, null, 2)}\n`, "utf8");

  return {
    runDirectory,
    workPackagePath,
    logFilePath,
    resultFilePath
  };
}

export async function runPreparedAdapterCommand(
  input: RunPreparedAdapterCommandInput
): Promise<AdapterProcessRunResult> {
  const logStream = createWriteStream(input.materializedRun.logFilePath, {
    flags: "a"
  });

  try {
    const child = spawn(input.execution.command, [...input.execution.args], {
      cwd: input.execution.workingDirectory,
      env: {
        ...process.env,
        ...input.execution.environment
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });

    const monitor = input.monitor;

    if (monitor) {
      // When monitor is provided, use manual data listeners so we can
      // deliver chunks to the callbacks as well as write to logStream.
      child.stdout?.on("data", (chunk: Buffer) => {
        logStream.write(chunk);
        monitor.onStdout?.(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        logStream.write(chunk);
        monitor.onStderr?.(chunk);
      });
    } else {
      // Default (backwards-compatible) path: pipe directly to logStream.
      child.stdout?.pipe(logStream, { end: false });
      child.stderr?.pipe(logStream, { end: false });
    }

    const pid = child.pid ?? 0;
    const commandString = [input.execution.command, ...input.execution.args].join(" ");
    const startedAt = new Date();

    if (monitor?.onStart && child.pid !== undefined) {
      monitor.onStart({ pid, command: commandString, startedAt });
    }

    let sigTermHandle: ReturnType<typeof setTimeout> | undefined;
    let sigKillHandle: ReturnType<typeof setTimeout> | undefined;

    if (monitor?.timeoutMs !== undefined && child.pid !== undefined) {
      const pid = child.pid;
      sigTermHandle = setTimeout(() => {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          // ESRCH: process already exited
        }
        sigKillHandle = setTimeout(async () => {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            // ESRCH: already dead
          }
          await rm(input.materializedRun.resultFilePath, { force: true });
        }, SIGKILL_GRACE_MS);
      }, monitor.timeoutMs);
    }

    const exit = await new Promise<{
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });

    if (sigTermHandle !== undefined) {
      clearTimeout(sigTermHandle);
    }
    if (sigKillHandle !== undefined) {
      clearTimeout(sigKillHandle);
    }

    if (monitor?.onComplete && child.pid !== undefined) {
      monitor.onComplete({
        pid,
        exitCode: exit.exitCode,
        signal: exit.signal,
        elapsedMs: Date.now() - startedAt.getTime()
      });
    }

    logStream.end();
    await once(logStream, "close");

    const result = await loadResultEnvelopeIfPresent(
      input.materializedRun.resultFilePath
    );

    return {
      workPackagePath: input.materializedRun.workPackagePath,
      resultFilePath: input.materializedRun.resultFilePath,
      logFilePath: input.materializedRun.logFilePath,
      exitCode: exit.exitCode,
      signal: exit.signal,
      ...(result ? { result } : {})
    };
  } catch (error) {
    logStream.end();
    await once(logStream, "close");
    throw error;
  }
}

async function loadResultEnvelopeIfPresent(
  resultFilePath: string
): Promise<AdapterResultEnvelope | null> {
  try {
    const resultText = await readFile(resultFilePath, "utf8");

    return parseAdapterResultEnvelope(JSON.parse(resultText));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
