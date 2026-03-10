import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

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

export interface RunPreparedAdapterCommandInput {
  readonly materializedRun: MaterializedAdapterRun;
  readonly execution: PreparedAdapterCommand;
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
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    const exit = await new Promise<{
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });

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
