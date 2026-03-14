import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadManifest,
  ManifestValidationError,
  parseManifestText
} from "../../src/config/load-manifest.js";

test("loadManifest parses the example manifest", async () => {
  const manifest = await loadManifest("agent-bus.example.yaml");

  assert.equal(manifest.version, 1);
  assert.equal(manifest.agents.length, 4);
  assert.equal(manifest.subscriptions.length, 3);
  assert.equal(manifest.approvalGates.length, 2);
});

test("parseManifestText rejects subscriptions that reference unknown agents", () => {
  assert.throws(
    () =>
      parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: planner
    runtime: codex
    command: [codex, run]
subscriptions:
  - agentId: missing_agent
    topic: plan_done
approvalGates: []
artifactConventions: []
`),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.includes("unknown agent ID"))
  );
});

test("parseManifestText rejects invalid approval gate configuration", () => {
  assert.throws(
    () =>
      parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: planner
    runtime: codex
    command: [codex, run]
subscriptions:
  - agentId: planner
    topic: plan_done
approvalGates:
  - topic: plan_done
    decision: manual
    approvers: []
    onReject: return_to_producer
artifactConventions: []
`),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.includes("approvalGates.0.approvers"))
  );
});

test("parseManifestText rejects duplicate agent/topic subscriptions", () => {
  assert.throws(
    () =>
      parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: planner
    runtime: codex
    command: [codex, run]
subscriptions:
  - agentId: planner
    topic: plan_done
  - agentId: planner
    topic: plan_done
approvalGates: []
artifactConventions: []
`),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.includes("duplicate agent/topic subscription"))
  );
});

test("parseManifestText rejects invalid artifact paths", () => {
  assert.throws(
    () =>
      parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: planner
    runtime: codex
    command: [codex, run]
subscriptions:
  - agentId: planner
    topic: plan_done
    requiredArtifacts:
      - path: ../secrets.txt
approvalGates: []
artifactConventions: []
`),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.includes("shared workspace"))
  );
});

test("parseManifestText preserves runtime adapter metadata for open-code agents", () => {
  const manifest = parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: coder_open_code
    runtime: open-code
    command: [opencode, run]
    workingDirectory: apps/worker/../adapter-runner
    environment:
      OPENCODE_AGENT: implement
subscriptions:
  - agentId: coder_open_code
    topic: implementation_ready
approvalGates: []
artifactConventions: []
`);

  assert.equal(manifest.agents[0]?.runtime, "open-code");
  assert.deepEqual(manifest.agents[0]?.command, ["opencode", "run"]);
  assert.equal(manifest.agents[0]?.workingDirectory, "apps/adapter-runner");
  assert.equal(manifest.agents[0]?.environment.OPENCODE_AGENT, "implement");
});

test("parseManifestText with timeout: 30 parses successfully with timeout as number", () => {
  const manifest = parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: agent_with_timeout
    runtime: codex
    command: [codex, run]
    timeout: 30
subscriptions:
  - agentId: agent_with_timeout
    topic: test_topic
approvalGates: []
artifactConventions: []
`);

  assert.equal(manifest.agents[0]?.timeout, 30);
});

test("parseManifestText without timeout field parses successfully with timeout as undefined", () => {
  const manifest = parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: agent_without_timeout
    runtime: codex
    command: [codex, run]
subscriptions:
  - agentId: agent_without_timeout
    topic: test_topic
approvalGates: []
artifactConventions: []
`);

  assert.equal(manifest.agents[0]?.timeout, undefined);
});

test("parseManifestText with timeout: 0 throws ManifestValidationError", () => {
  assert.throws(
    () =>
      parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: agent_with_zero_timeout
    runtime: codex
    command: [codex, run]
    timeout: 0
subscriptions:
  - agentId: agent_with_zero_timeout
    topic: test_topic
approvalGates: []
artifactConventions: []
`),
    (error: unknown) =>
      error instanceof ManifestValidationError
  );
});

test("parseManifestText with timeout: -5 throws ManifestValidationError", () => {
  assert.throws(
    () =>
      parseManifestText(`
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs
agents:
  - id: agent_with_negative_timeout
    runtime: codex
    command: [codex, run]
    timeout: -5
subscriptions:
  - agentId: agent_with_negative_timeout
    topic: test_topic
approvalGates: []
artifactConventions: []
`),
    (error: unknown) =>
      error instanceof ManifestValidationError
  );
});
