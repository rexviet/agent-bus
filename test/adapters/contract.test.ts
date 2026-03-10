import * as assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import {
  createAdapterWorkPackage,
  parseAdapterResultEnvelope
} from "../../src/adapters/contract.js";
import {
  assertSupportedRuntimeFamily,
  getRuntimeDefinition,
  guessRuntimeFamilyFromExecutable
} from "../../src/adapters/registry.js";
import { createRuntimeLayout } from "../../src/shared/runtime-layout.js";

test("createAdapterWorkPackage resolves artifact inputs and workspace paths", () => {
  const repositoryRoot = path.resolve("/tmp/agent-bus-contract");
  const layout = createRuntimeLayout({ repositoryRoot });

  const workPackage = createAdapterWorkPackage({
    agent: {
      id: "coder_open_code",
      runtime: "open-code"
    },
    delivery: {
      deliveryId: "delivery:550e8400-e29b-41d4-a716-446655440201:coder_open_code",
      eventId: "550e8400-e29b-41d4-a716-446655440201",
      agentId: "coder_open_code",
      topic: "implementation_ready",
      status: "ready",
      availableAt: "2026-03-10T04:30:00Z",
      attemptCount: 0,
      maxAttempts: 3,
      replayCount: 0,
      createdAt: "2026-03-10T04:30:00Z",
      updatedAt: "2026-03-10T04:30:00Z"
    },
    event: {
      eventId: "550e8400-e29b-41d4-a716-446655440201",
      runId: "run-contract-001",
      topic: "implementation_ready",
      correlationId: "run-contract-001",
      dedupeKey: "implementation_ready:run-contract-001",
      approvalStatus: "not_required",
      producer: {
        agentId: "planner_codex",
        runtime: "codex"
      },
      payload: {
        task: "Implement adapter contract"
      },
      occurredAt: "2026-03-10T04:29:00Z",
      createdAt: "2026-03-10T04:30:00Z",
      artifactRefs: [
        {
          path: "docs/plan.md",
          role: "input"
        }
      ]
    },
    layout,
    workingDirectory: "src/daemon",
    resultFilePath: path.join(layout.stateDir, "adapters", "result.json"),
    logFilePath: path.join(layout.logsDir, "adapters", "execution.log"),
    requiredArtifacts: [
      {
        path: "docs/plan.md",
        role: "input"
      }
    ]
  });

  assert.equal(workPackage.workspace.workingDirectory, path.join(repositoryRoot, "src/daemon"));
  assert.equal(workPackage.artifactInputs.length, 1);
  assert.equal(
    workPackage.artifactInputs[0]?.absolutePath,
    path.join(repositoryRoot, "workspace", "docs", "plan.md")
  );
  assert.equal(
    workPackage.workspace.resultFilePath,
    path.join(repositoryRoot, ".agent-bus", "state", "adapters", "result.json")
  );
});

test("createAdapterWorkPackage rejects result files outside the state directory", () => {
  const repositoryRoot = path.resolve("/tmp/agent-bus-contract");
  const layout = createRuntimeLayout({ repositoryRoot });

  assert.throws(
    () =>
      createAdapterWorkPackage({
        agent: {
          id: "planner_codex",
          runtime: "codex"
        },
        delivery: {
          deliveryId: "delivery:550e8400-e29b-41d4-a716-446655440202:planner_codex",
          eventId: "550e8400-e29b-41d4-a716-446655440202",
          agentId: "planner_codex",
          topic: "plan_done",
          status: "ready",
          availableAt: "2026-03-10T04:35:00Z",
          attemptCount: 0,
          maxAttempts: 3,
          replayCount: 0,
          createdAt: "2026-03-10T04:35:00Z",
          updatedAt: "2026-03-10T04:35:00Z"
        },
        event: {
          eventId: "550e8400-e29b-41d4-a716-446655440202",
          runId: "run-contract-002",
          topic: "plan_done",
          correlationId: "run-contract-002",
          dedupeKey: "plan_done:run-contract-002",
          approvalStatus: "approved",
          producer: {
            agentId: "planner_codex",
            runtime: "codex"
          },
          payload: {},
          occurredAt: "2026-03-10T04:35:00Z",
          createdAt: "2026-03-10T04:35:00Z",
          artifactRefs: []
        },
        layout,
        resultFilePath: path.join(repositoryRoot, "workspace", "result.json"),
        logFilePath: path.join(layout.logsDir, "adapters", "execution.log")
      }),
    /Adapter result file must stay inside/
  );
});

test("parseAdapterResultEnvelope accepts emitted events and output artifacts", () => {
  const result = parseAdapterResultEnvelope({
    schemaVersion: 1,
    status: "success",
    summary: "Implemented the requested adapter changes.",
    outputArtifacts: [
      {
        path: "docs/system-design.md",
        role: "primary"
      }
    ],
    events: [
      {
        topic: "system_design_done",
        payload: {
          status: "complete"
        },
        artifactRefs: [
          {
            path: "docs/system-design.md",
            role: "primary"
          }
        ]
      }
    ]
  });

  assert.equal(result.status, "success");
  assert.equal(result.outputArtifacts.length, 1);
  assert.equal(result.events[0]?.topic, "system_design_done");
});

test("runtime registry exposes stable runtime identities and executable aliases", () => {
  assert.equal(assertSupportedRuntimeFamily("codex").displayName, "Codex");
  assert.equal(getRuntimeDefinition("open-code")?.executableCandidates[0], "opencode");
  assert.equal(guessRuntimeFamilyFromExecutable("opencode"), "open-code");
  assert.equal(guessRuntimeFamilyFromExecutable("antigravity"), "antigravity");
  assert.throws(() => assertSupportedRuntimeFamily("claude-code"), /Unsupported runtime family/);
});
