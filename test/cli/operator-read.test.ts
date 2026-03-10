import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { main } from "../../src/cli.js";
import { startDaemon } from "../../src/daemon/index.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

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

async function withTempRepo(
  callback: (configPath: string, repositoryRoot: string) => Promise<void>
): Promise<void> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-cli-read-"));
  const configPath = path.join(repositoryRoot, "agent-bus.yaml");

  try {
    await writeFile(
      configPath,
      `version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: ba_codex
    runtime: codex
    command: [codex, run]
  - id: tech_lead_claude
    runtime: claude-code
    command: [claude, run]
  - id: coder_open_code
    runtime: open-code
    command: [open-code, run]

subscriptions:
  - agentId: tech_lead_claude
    topic: plan_done
  - agentId: coder_open_code
    topic: implementation_ready

approvalGates:
  - topic: plan_done
    decision: manual
    approvers: [human]
    onReject: return_to_producer

artifactConventions: []
`,
      "utf8"
    );

    await callback(configPath, repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

async function seedOperatorState(configPath: string, repositoryRoot: string): Promise<void> {
  const daemon = await startDaemon({
    configPath,
    repositoryRoot,
    registerSignalHandlers: false,
    recoveryIntervalMs: 5_000
  });

  try {
    daemon.publish(
      parseEventEnvelope({
        eventId: "550e8400-e29b-41d4-a716-446655440601",
        topic: "plan_done",
        runId: "run-cli-approval",
        correlationId: "run-cli-approval",
        dedupeKey: "plan_done:run-cli-approval",
        occurredAt: "2026-03-09T18:00:00Z",
        producer: {
          agentId: "ba_codex",
          runtime: "codex"
        },
        payload: {},
        payloadMetadata: {},
        artifactRefs: []
      })
    );

    daemon.publish(
      parseEventEnvelope({
        eventId: "550e8400-e29b-41d4-a716-446655440602",
        topic: "implementation_ready",
        runId: "run-cli-failure",
        correlationId: "run-cli-failure",
        dedupeKey: "implementation_ready:run-cli-failure",
        occurredAt: "2026-03-09T18:05:00Z",
        producer: {
          agentId: "tech_lead_claude",
          runtime: "claude-code"
        },
        payload: {},
        payloadMetadata: {},
        artifactRefs: []
      })
    );

    const claimed = daemon.claimDelivery("worker-cli", 60_000);

    assert.ok(claimed);

    daemon.failDelivery(
      claimed?.deliveryId as string,
      claimed?.leaseToken as string,
      "simulated adapter failure",
      0,
      "2026-03-09T18:06:00Z"
    );
  } finally {
    await daemon.stop();
  }
}

test("read-only operator commands expose runs, approvals, and failures", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    await seedOperatorState(configPath, repositoryRoot);

    const runsList = await runCli(["runs", "list"], repositoryRoot);
    const runDetail = await runCli(
      ["runs", "show", "run-cli-failure", "--json"],
      repositoryRoot
    );
    const approvalsList = await runCli(["approvals", "list"], repositoryRoot);
    const failuresList = await runCli(
      ["failures", "list", "--json"],
      repositoryRoot
    );

    assert.equal(runsList.exitCode, 0);
    assert.match(runsList.stdout, /Runs \(2\)/);
    assert.match(runsList.stdout, /run-cli-approval status=awaiting_approval/);
    assert.match(runsList.stdout, /run-cli-failure status=attention_required/);

    assert.equal(runDetail.exitCode, 0);
    assert.equal(JSON.parse(runDetail.stdout).runId, "run-cli-failure");
    assert.equal(JSON.parse(runDetail.stdout).deliveries[0].status, "retry_scheduled");

    assert.equal(approvalsList.exitCode, 0);
    assert.match(approvalsList.stdout, /Pending approvals \(1\)/);
    assert.match(approvalsList.stdout, /run=run-cli-approval/);

    assert.equal(failuresList.exitCode, 0);
    assert.equal(JSON.parse(failuresList.stdout)[0].runId, "run-cli-failure");
    assert.equal(JSON.parse(failuresList.stdout)[0].lastError, "simulated adapter failure");
  });
});

test("CLI preserves existing top-level commands after the operator parser refactor", async () => {
  await withTempRepo(async (_configPath, repositoryRoot) => {
    const result = await runCli(["validate-manifest", "agent-bus.yaml"], repositoryRoot);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Manifest is valid: agent-bus.yaml/);
  });
});

test("operator CLI returns clear errors for missing runs and unknown subcommands", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
    await seedOperatorState(configPath, repositoryRoot);

    const missingRun = await runCli(["runs", "show", "missing-run"], repositoryRoot);
    const unknownSubcommand = await runCli(["runs", "inspect"], repositoryRoot);

    assert.equal(missingRun.exitCode, 1);
    assert.match(missingRun.stderr, /Run not found: missing-run/);
    assert.equal(unknownSubcommand.exitCode, 1);
    assert.match(unknownSubcommand.stderr, /Unknown runs subcommand: inspect/);
  });
});
