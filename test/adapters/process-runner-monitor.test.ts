import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  type ProcessMonitorCallbacks,
  runPreparedAdapterCommand
} from "../../src/adapters/process-runner.js";

/**
 * Absolute path to the monitor fixture script.
 * Uses process.cwd() so the path resolves correctly whether running from
 * the project root (as tests are) regardless of whether we're in dist/ or src/.
 */
const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "test/fixtures/adapters/monitor-fixture.mjs"
);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ab-monitor-"));

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeRun(dir: string) {
  return {
    runDirectory: dir,
    workPackagePath: path.join(dir, "work-package.json"),
    logFilePath: path.join(dir, "agent.log"),
    resultFilePath: path.join(dir, "result.json")
  };
}

function makeExecution(env: Record<string, string> = {}, cwd?: string) {
  return {
    command: process.execPath,
    args: [FIXTURE_PATH],
    workingDirectory: cwd ?? process.cwd(),
    environment: env
  };
}

// -----------------------------------------------------------------------
// Test 1: No monitor - backwards compatible
// -----------------------------------------------------------------------
test("no monitor: runPreparedAdapterCommand behaves identically to current", async () => {
  await withTempDir(async (dir) => {
    const materializedRun = makeRun(dir);

    // Write a dummy work-package.json so the path exists
    await writeFile(materializedRun.workPackagePath, "{}", "utf8");

    const result = await runPreparedAdapterCommand({
      materializedRun,
      execution: makeExecution({ FIXTURE_STDOUT_LINES: "no-monitor-line" }, dir)
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);

    // Log file should have been written
    const log = await readFile(materializedRun.logFilePath, "utf8");
    assert.ok(log.includes("no-monitor-line"), `Expected log file to contain output, got: ${log}`);
  });
});

// -----------------------------------------------------------------------
// Test 2: onStdout callback receives chunks AND log file is still written
// -----------------------------------------------------------------------
test("onStdout: chunk delivered to callback AND written to log file", async () => {
  await withTempDir(async (dir) => {
    const chunks: Buffer[] = [];
    const monitor: ProcessMonitorCallbacks = {
      onStdout: (chunk) => {
        chunks.push(chunk);
      }
    };

    const materializedRun = makeRun(dir);
    await writeFile(materializedRun.workPackagePath, "{}", "utf8");

    await runPreparedAdapterCommand({
      materializedRun,
      execution: makeExecution({ FIXTURE_STDOUT_LINES: "alpha-out,beta-out" }, dir),
      monitor
    });

    const combined = chunks.map((c) => c.toString()).join("");
    assert.ok(combined.includes("alpha-out"), `Callback should receive 'alpha-out', got: ${combined}`);
    assert.ok(combined.includes("beta-out"), `Callback should receive 'beta-out', got: ${combined}`);

    const log = await readFile(materializedRun.logFilePath, "utf8");
    assert.ok(log.includes("alpha-out"), `Log file should contain 'alpha-out', got: ${log}`);
    assert.ok(log.includes("beta-out"), `Log file should contain 'beta-out', got: ${log}`);
  });
});

// -----------------------------------------------------------------------
// Test 3: onStderr callback receives chunks AND log file is still written
// -----------------------------------------------------------------------
test("onStderr: chunk delivered to callback AND written to log file", async () => {
  await withTempDir(async (dir) => {
    const chunks: Buffer[] = [];
    const monitor: ProcessMonitorCallbacks = {
      onStderr: (chunk) => {
        chunks.push(chunk);
      }
    };

    const materializedRun = makeRun(dir);
    await writeFile(materializedRun.workPackagePath, "{}", "utf8");

    await runPreparedAdapterCommand({
      materializedRun,
      execution: makeExecution(
        { FIXTURE_STDOUT_LINES: "", FIXTURE_STDERR_LINES: "err-alpha,err-beta" },
        dir
      ),
      monitor
    });

    const combined = chunks.map((c) => c.toString()).join("");
    assert.ok(combined.includes("err-alpha"), `Callback should receive 'err-alpha', got: ${combined}`);
    assert.ok(combined.includes("err-beta"), `Callback should receive 'err-beta', got: ${combined}`);

    const log = await readFile(materializedRun.logFilePath, "utf8");
    assert.ok(log.includes("err-alpha"), `Log file should contain 'err-alpha', got: ${log}`);
    assert.ok(log.includes("err-beta"), `Log file should contain 'err-beta', got: ${log}`);
  });
});

// -----------------------------------------------------------------------
// Test 4: timeoutMs kills process with SIGTERM when exceeded
// -----------------------------------------------------------------------
test("timeoutMs: process killed with SIGTERM when timeout exceeded", async () => {
  await withTempDir(async (dir) => {
    const monitor: ProcessMonitorCallbacks = {
      timeoutMs: 200 // 200ms — fixture will sleep 3000ms
    };

    const materializedRun = makeRun(dir);
    await writeFile(materializedRun.workPackagePath, "{}", "utf8");

    const before = Date.now();
    const result = await runPreparedAdapterCommand({
      materializedRun,
      execution: makeExecution({ FIXTURE_DELAY_MS: "3000" }, dir),
      monitor
    });
    const elapsed = Date.now() - before;

    assert.equal(result.signal, "SIGTERM", `Expected SIGTERM, got signal=${result.signal} exitCode=${result.exitCode}`);
    assert.ok(elapsed < 2000, `Process should have been killed quickly, took ${elapsed}ms`);
  });
});

// -----------------------------------------------------------------------
// Test 5: timeoutMs - process completes before timeout, no kill
// -----------------------------------------------------------------------
test("timeoutMs: no kill when process completes within timeout", async () => {
  await withTempDir(async (dir) => {
    const monitor: ProcessMonitorCallbacks = {
      timeoutMs: 10_000 // 10s - process completes instantly
    };

    const materializedRun = makeRun(dir);
    await writeFile(materializedRun.workPackagePath, "{}", "utf8");

    const result = await runPreparedAdapterCommand({
      materializedRun,
      execution: makeExecution({}, dir),
      monitor
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
  });
});

// -----------------------------------------------------------------------
// Test 6: onStart called with { pid, command, startedAt }
// -----------------------------------------------------------------------
test("onStart: called once with pid, command, startedAt when process spawns", async () => {
  await withTempDir(async (dir) => {
    const calls: Array<{ pid: number; command: string; startedAt: Date }> = [];
    const monitor: ProcessMonitorCallbacks = {
      onStart: (info) => {
        calls.push(info);
      }
    };

    const materializedRun = makeRun(dir);
    await writeFile(materializedRun.workPackagePath, "{}", "utf8");

    await runPreparedAdapterCommand({
      materializedRun,
      execution: makeExecution({}, dir),
      monitor
    });

    assert.equal(calls.length, 1, "onStart should be called exactly once");
    const info = calls[0]!;
    assert.ok(typeof info.pid === "number" && info.pid > 0, `pid should be a positive integer, got: ${info.pid}`);
    assert.ok(typeof info.command === "string" && info.command.length > 0, "command should be a non-empty string");
    assert.ok(info.startedAt instanceof Date, "startedAt should be a Date instance");
  });
});

// -----------------------------------------------------------------------
// Test 7: onComplete called with { pid, exitCode, signal, elapsedMs }
// -----------------------------------------------------------------------
test("onComplete: called once with pid, exitCode, signal, elapsedMs when process ends", async () => {
  await withTempDir(async (dir) => {
    const calls: Array<{
      pid: number;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      elapsedMs: number;
    }> = [];
    const monitor: ProcessMonitorCallbacks = {
      onComplete: (info) => {
        calls.push(info);
      }
    };

    const materializedRun = makeRun(dir);
    await writeFile(materializedRun.workPackagePath, "{}", "utf8");

    const result = await runPreparedAdapterCommand({
      materializedRun,
      execution: makeExecution({}, dir),
      monitor
    });

    assert.equal(calls.length, 1, "onComplete should be called exactly once");
    const info = calls[0]!;
    assert.ok(typeof info.pid === "number" && info.pid > 0, `pid should be a positive integer, got: ${info.pid}`);
    assert.equal(info.exitCode, result.exitCode);
    assert.equal(info.signal, result.signal);
    assert.ok(
      typeof info.elapsedMs === "number" && info.elapsedMs >= 0,
      `elapsedMs should be a non-negative number, got: ${info.elapsedMs}`
    );
  });
});
