import * as assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-bus-cli-mutate-"));
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

test("publish loads a file-backed envelope and rejects invalid payloads", async () => {
  await withTempRepo(async (_configPath, repositoryRoot) => {
    const envelopeDir = path.join(repositoryRoot, "envelopes");

    await mkdir(envelopeDir, { recursive: true });
    await writeFile(
      path.join(envelopeDir, "plan-done.json"),
      JSON.stringify(
        {
          eventId: "550e8400-e29b-41d4-a716-446655440701",
          topic: "plan_done",
          runId: "run-cli-publish",
          correlationId: "run-cli-publish",
          dedupeKey: "plan_done:run-cli-publish",
          occurredAt: "2026-03-09T19:00:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(envelopeDir, "invalid.json"),
      JSON.stringify(
        {
          eventId: "not-a-uuid",
          topic: "INVALID_TOPIC"
        },
        null,
        2
      ),
      "utf8"
    );

    const published = await runCli(
      ["publish", "--envelope", "envelopes/plan-done.json", "--json"],
      repositoryRoot
    );
    const invalid = await runCli(
      ["publish", "--envelope", "envelopes/invalid.json"],
      repositoryRoot
    );

    assert.equal(published.exitCode, 0);
    assert.equal(JSON.parse(published.stdout).eventId, "550e8400-e29b-41d4-a716-446655440701");
    assert.equal(JSON.parse(published.stdout).approvalStatus, "pending");
    assert.equal(invalid.exitCode, 1);
    assert.match(invalid.stderr, /invalid/i);
  });
});

test("publish prints schema validation rejection message for reject-enforced topics", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
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

schemas:
  plan_done:
    enforcement: reject
    schema:
      type: object
      properties:
        sequence:
          type: integer
      required:
        - sequence
      additionalProperties: false

approvalGates:
  - topic: plan_done
    decision: manual
    approvers: [human]
    onReject: return_to_producer

artifactConventions: []
`,
      "utf8"
    );

    const envelopeDir = path.join(repositoryRoot, "envelopes");
    const envelopePath = path.join(envelopeDir, "schema-reject.json");

    await mkdir(envelopeDir, { recursive: true });
    await writeFile(
      envelopePath,
      JSON.stringify(
        {
          eventId: "550e8400-e29b-41d4-a716-446655440707",
          topic: "plan_done",
          runId: "run-cli-schema-reject",
          correlationId: "run-cli-schema-reject",
          dedupeKey: "plan_done:run-cli-schema-reject",
          occurredAt: "2026-03-09T19:13:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {
            sequence: "invalid"
          },
          payloadMetadata: {},
          artifactRefs: []
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runCli(
      ["publish", "--envelope", "envelopes/schema-reject.json"],
      repositoryRoot
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Schema validation failed for topic plan_done/);
  });
});

test("publish logs schema validation warning and persists event for warn-enforced topics", async () => {
  await withTempRepo(async (configPath, repositoryRoot) => {
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

schemas:
  plan_done:
    enforcement: warn
    schema:
      type: object
      properties:
        sequence:
          type: integer
      required:
        - sequence
      additionalProperties: false

approvalGates:
  - topic: plan_done
    decision: manual
    approvers: [human]
    onReject: return_to_producer

artifactConventions: []
`,
      "utf8"
    );

    const envelopeDir = path.join(repositoryRoot, "envelopes");
    const envelopePath = path.join(envelopeDir, "schema-warn.json");

    await mkdir(envelopeDir, { recursive: true });
    await writeFile(
      envelopePath,
      JSON.stringify(
        {
          eventId: "550e8400-e29b-41d4-a716-446655440708",
          topic: "plan_done",
          runId: "run-cli-schema-warn",
          correlationId: "run-cli-schema-warn",
          dedupeKey: "plan_done:run-cli-schema-warn",
          occurredAt: "2026-03-09T19:14:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {
            sequence: "invalid"
          },
          payloadMetadata: {},
          artifactRefs: []
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runCli(
      ["publish", "--envelope", "envelopes/schema-warn.json", "--json"],
      repositoryRoot
    );
    const runDetail = await runCli(
      ["runs", "show", "run-cli-schema-warn", "--json"],
      repositoryRoot
    );

    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout).eventId, "550e8400-e29b-41d4-a716-446655440708");
    assert.match(
      result.stderr,
      /schema\.validation_failed|Event payload failed schema validation/i
    );

    assert.equal(runDetail.exitCode, 0);
    assert.equal(JSON.parse(runDetail.stdout).runId, "run-cli-schema-warn");
    assert.equal(JSON.parse(runDetail.stdout).eventCount, 1);
  });
});

test("approval mutation commands preserve actor attribution and rejection feedback", async () => {
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
          eventId: "550e8400-e29b-41d4-a716-446655440702",
          topic: "plan_done",
          runId: "run-cli-approve",
          correlationId: "run-cli-approve",
          dedupeKey: "plan_done:run-cli-approve",
          occurredAt: "2026-03-09T19:05:00Z",
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
          eventId: "550e8400-e29b-41d4-a716-446655440703",
          topic: "plan_done",
          runId: "run-cli-reject",
          correlationId: "run-cli-reject",
          dedupeKey: "plan_done:run-cli-reject",
          occurredAt: "2026-03-09T19:06:00Z",
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

    const approved = await runCli(
      [
        "approvals",
        "approve",
        "approval:550e8400-e29b-41d4-a716-446655440702",
        "--by",
        "human-approver",
        "--json"
      ],
      repositoryRoot
    );
    const rejected = await runCli(
      [
        "approvals",
        "reject",
        "approval:550e8400-e29b-41d4-a716-446655440703",
        "--by",
        "human-reviewer",
        "--feedback",
        "Needs rework.",
        "--json"
      ],
      repositoryRoot
    );
    const missingActor = await runCli(
      ["approvals", "approve", "approval:550e8400-e29b-41d4-a716-446655440702"],
      repositoryRoot
    );

    assert.equal(approved.exitCode, 0);
    assert.equal(JSON.parse(approved.stdout).approval.status, "approved");
    assert.equal(JSON.parse(approved.stdout).approval.decidedBy, "human-approver");
    assert.equal(JSON.parse(approved.stdout).deliveries[0].status, "ready");

    assert.equal(rejected.exitCode, 0);
    assert.equal(JSON.parse(rejected.stdout).approval.status, "rejected");
    assert.equal(JSON.parse(rejected.stdout).approval.feedback, "Needs rework.");
    assert.equal(JSON.parse(rejected.stdout).deliveries[0].status, "cancelled");

    assert.equal(missingActor.exitCode, 1);
    assert.match(missingActor.stderr, /requires --by <actor>/);
  });
});

test("replay commands support allowed replays and block rejected approval flows", async () => {
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
          eventId: "550e8400-e29b-41d4-a716-446655440704",
          topic: "implementation_ready",
          runId: "run-cli-replay-event",
          correlationId: "run-cli-replay-event",
          dedupeKey: "implementation_ready:run-cli-replay-event",
          occurredAt: "2026-03-09T19:10:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );
      daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440705",
          topic: "implementation_ready",
          runId: "run-cli-replay-delivery",
          correlationId: "run-cli-replay-delivery",
          dedupeKey: "implementation_ready:run-cli-replay-delivery",
          occurredAt: "2026-03-09T19:11:00Z",
          producer: {
            agentId: "tech_lead_claude",
            runtime: "claude-code"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );
      const rejectedEvent = daemon.publish(
        parseEventEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440706",
          topic: "plan_done",
          runId: "run-cli-replay-blocked",
          correlationId: "run-cli-replay-blocked",
          dedupeKey: "plan_done:run-cli-replay-blocked",
          occurredAt: "2026-03-09T19:12:00Z",
          producer: {
            agentId: "ba_codex",
            runtime: "codex"
          },
          payload: {},
          payloadMetadata: {},
          artifactRefs: []
        })
      );

      const deliveryIds = [
        "delivery:550e8400-e29b-41d4-a716-446655440704:coder_open_code",
        "delivery:550e8400-e29b-41d4-a716-446655440705:coder_open_code"
      ];

      for (const [index] of deliveryIds.entries()) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const claimed = daemon.claimDelivery(`worker-${index}-${attempt}`, 60_000);

          assert.ok(claimed);
          daemon.failDelivery(
            claimed?.deliveryId as string,
            claimed?.leaseToken as string,
            `failure-${index}-${attempt}`,
            0,
            `2026-03-09T19:${String(10 + index * 10 + attempt).padStart(2, "0")}:00Z`
          );
        }
      }

      const rejectedApproval = daemon.getApprovalForEvent(rejectedEvent.eventId);

      assert.ok(rejectedApproval);

      daemon.reject(
        rejectedApproval?.approvalId as string,
        "human-reviewer",
        "Rejected before replay."
      );
    } finally {
      await daemon.stop();
    }

    const replayEvent = await runCli(
      [
        "replay",
        "event",
        "550e8400-e29b-41d4-a716-446655440704",
        "--available-at",
        "2026-03-09T19:20:00Z",
        "--json"
      ],
      repositoryRoot
    );
    const replayDelivery = await runCli(
      [
        "replay",
        "delivery",
        "delivery:550e8400-e29b-41d4-a716-446655440705:coder_open_code",
        "--json"
      ],
      repositoryRoot
    );
    const blockedReplay = await runCli(
      ["replay", "event", "550e8400-e29b-41d4-a716-446655440706"],
      repositoryRoot
    );

    assert.equal(replayEvent.exitCode, 0);
    assert.equal(JSON.parse(replayEvent.stdout).deliveries[0].status, "ready");
    assert.equal(JSON.parse(replayEvent.stdout).deliveries[0].replayCount, 1);

    assert.equal(replayDelivery.exitCode, 0);
    assert.equal(JSON.parse(replayDelivery.stdout).status, "ready");
    assert.equal(JSON.parse(replayDelivery.stdout).replayCount, 1);

    assert.equal(blockedReplay.exitCode, 1);
    assert.match(blockedReplay.stderr, /approved or not_required approval status/);
  });
});
