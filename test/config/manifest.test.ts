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
