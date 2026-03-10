import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { main } from "../../src/cli.js";
import { startDaemon } from "../../src/daemon/index.js";

const execFileAsync = promisify(execFile);

interface CapturedRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
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

async function withDemoRepo(
  callback: (repositoryRoot: string, configRelativePath: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-operator-demo-"));
  const configRelativePath = "examples/operator-demo/agent-bus.demo.yaml";

  try {
    await cp(path.resolve("examples/operator-demo"), path.join(repositoryRoot, "examples/operator-demo"), {
      recursive: true
    });
    await cp(
      path.resolve("test/fixtures/agents"),
      path.join(repositoryRoot, "test/fixtures/agents"),
      { recursive: true }
    );

    await callback(repositoryRoot, configRelativePath);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

async function runWorkerUntilIdle(
  repositoryRoot: string,
  configRelativePath: string,
  workerPrefix: string
) {
  const daemon = await startDaemon({
    configPath: path.join(repositoryRoot, configRelativePath),
    repositoryRoot,
    registerSignalHandlers: false,
    recoveryIntervalMs: 5_000
  });

  const results = [];

  try {
    for (let attempt = 1; ; attempt += 1) {
      const result = await daemon.runWorkerIteration(`${workerPrefix}-${attempt}`, 60_000);

      if (!result) {
        break;
      }

      results.push(result);
    }
  } finally {
    await daemon.stop();
  }

  return results;
}

test("operator workflow demo exercises publish, approval, failure inspection, replay, and artifact completion", async () => {
  await withDemoRepo(async (repositoryRoot, configRelativePath) => {
    const publishResult = await runCli(
      [
        "publish",
        "--config",
        configRelativePath,
        "--envelope",
        "examples/operator-demo/envelopes/plan-done.json",
        "--json"
      ],
      repositoryRoot
    );
    const approvalsBefore = await runCli(
      ["approvals", "list", "--config", configRelativePath, "--json"],
      repositoryRoot
    );

    assert.equal(publishResult.exitCode, 0);
    assert.equal(JSON.parse(publishResult.stdout).approvalStatus, "pending");
    assert.equal(approvalsBefore.exitCode, 0);
    assert.equal(JSON.parse(approvalsBefore.stdout).length, 1);

    const approvalId = JSON.parse(approvalsBefore.stdout)[0].approvalId;
    const approveResult = await runCli(
      [
        "approvals",
        "approve",
        approvalId,
        "--config",
        configRelativePath,
        "--by",
        "human-demo",
        "--json"
      ],
      repositoryRoot
    );

    assert.equal(approveResult.exitCode, 0);
    assert.equal(JSON.parse(approveResult.stdout).approval.status, "approved");

    const initialWorkerResults = await runWorkerUntilIdle(
      repositoryRoot,
      configRelativePath,
      "demo-initial"
    );

    assert.equal(initialWorkerResults.length, 2);
    assert.ok(
      initialWorkerResults.some((result) => result.status === "success"),
      "expected one successful demo worker iteration"
    );
    assert.ok(
      initialWorkerResults.some((result) => result.status === "retryable_error"),
      "expected one induced retryable failure for replay"
    );

    const failuresDuringDemo = await runCli(
      ["failures", "list", "--config", configRelativePath, "--json"],
      repositoryRoot
    );
    const failureRows = JSON.parse(failuresDuringDemo.stdout);

    assert.equal(failuresDuringDemo.exitCode, 0);
    assert.equal(failureRows.length, 1);

    const replayResult = await runCli(
      [
        "replay",
        "delivery",
        failureRows[0].deliveryId,
        "--config",
        configRelativePath,
        "--json"
      ],
      repositoryRoot
    );

    assert.equal(replayResult.exitCode, 0);
    assert.equal(JSON.parse(replayResult.stdout).status, "ready");

    const replayWorkerResults = await runWorkerUntilIdle(
      repositoryRoot,
      configRelativePath,
      "demo-replay"
    );
    const runDetail = await runCli(
      ["runs", "show", "run-demo-001", "--config", configRelativePath, "--json"],
      repositoryRoot
    );
    const failuresAfterReplay = await runCli(
      ["failures", "list", "--config", configRelativePath],
      repositoryRoot
    );
    const systemDesignPath = path.join(
      repositoryRoot,
      "examples/operator-demo/workspace/docs/system-design.md"
    );
    const testCasesPath = path.join(
      repositoryRoot,
      "examples/operator-demo/workspace/docs/test-cases.md"
    );

    assert.equal(replayWorkerResults.length, 1);
    assert.equal(replayWorkerResults[0]?.status, "success");
    assert.equal(runDetail.exitCode, 0);
    assert.equal(JSON.parse(runDetail.stdout).status, "completed");
    assert.match(failuresAfterReplay.stdout, /No failure deliveries found/);
    assert.match(await readFile(systemDesignPath, "utf8"), /System Design/);
    assert.match(await readFile(testCasesPath, "utf8"), /Test Cases/);
  });
});

test("demo reset script clears runtime state so the workflow can be rerun deterministically", async () => {
  await withDemoRepo(async (repositoryRoot, configRelativePath) => {
    const publish = await runCli(
      [
        "publish",
        "--config",
        configRelativePath,
        "--envelope",
        "examples/operator-demo/envelopes/plan-done.json"
      ],
      repositoryRoot
    );
    const approve = await runCli(
      [
        "approvals",
        "approve",
        "approval:550e8400-e29b-41d4-a716-446655440801",
        "--config",
        configRelativePath,
        "--by",
        "human-demo"
      ],
      repositoryRoot
    );
    const firstRun = await runWorkerUntilIdle(
      repositoryRoot,
      configRelativePath,
      "demo-reset-first"
    );

    assert.equal(publish.exitCode, 0);
    assert.equal(approve.exitCode, 0);
    assert.ok(firstRun.some((result) => result.status === "retryable_error"));

    await execFileAsync(process.execPath, ["examples/operator-demo/reset-demo.mjs"], {
      cwd: repositoryRoot
    });

    const republished = await runCli(
      [
        "publish",
        "--config",
        configRelativePath,
        "--envelope",
        "examples/operator-demo/envelopes/plan-done.json",
        "--json"
      ],
      repositoryRoot
    );
    const reapproved = await runCli(
      [
        "approvals",
        "approve",
        "approval:550e8400-e29b-41d4-a716-446655440801",
        "--config",
        configRelativePath,
        "--by",
        "human-demo"
      ],
      repositoryRoot
    );
    const secondRun = await runWorkerUntilIdle(
      repositoryRoot,
      configRelativePath,
      "demo-reset-second"
    );

    assert.equal(republished.exitCode, 0);
    assert.equal(JSON.parse(republished.stdout).eventId, "550e8400-e29b-41d4-a716-446655440801");
    assert.equal(reapproved.exitCode, 0);
    assert.ok(
      secondRun.some((result) => result.status === "retryable_error"),
      "expected reset demo to reproduce the first-run QA failure"
    );
    assert.ok(
      secondRun.some((result) => result.status === "success"),
      "expected reset demo to reproduce the successful tech-lead delivery"
    );
  });
});
