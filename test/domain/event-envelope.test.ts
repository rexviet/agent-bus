import * as assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeArtifactRefPath } from "../../src/domain/artifact-ref.js";
import { parseEventEnvelope } from "../../src/domain/event-envelope.js";

test("parseEventEnvelope accepts a valid event envelope", () => {
  const envelope = parseEventEnvelope({
    eventId: "550e8400-e29b-41d4-a716-446655440000",
    topic: "plan_done",
    runId: "run-001",
    correlationId: "run-001",
    dedupeKey: "plan_done:run-001",
    occurredAt: "2026-03-09T15:00:00Z",
    producer: {
      agentId: "ba_codex",
      runtime: "codex",
      model: "gpt-5"
    },
    payload: {
      approvalState: "pending"
    },
    payloadMetadata: {
      schemaVersion: 1
    },
    artifactRefs: [
      {
        path: "docs/plan.md",
        role: "primary"
      }
    ]
  });

  assert.equal(envelope.topic, "plan_done");
  assert.equal(envelope.artifactRefs[0]?.path, "docs/plan.md");
});

test("normalizeArtifactRefPath rejects absolute and escaping paths", () => {
  assert.throws(() => normalizeArtifactRefPath("/tmp/plan.md"));
  assert.throws(() => normalizeArtifactRefPath("../plan.md"));
});

test("parseEventEnvelope rejects missing identifiers and invalid artifact paths", () => {
  assert.throws(() =>
    parseEventEnvelope({
      eventId: "not-a-uuid",
      topic: "Plan Done",
      runId: "",
      correlationId: "",
      dedupeKey: "",
      occurredAt: "invalid-date",
      producer: {
        agentId: "",
        runtime: ""
      },
      payload: {},
      payloadMetadata: {},
      artifactRefs: [
        {
          path: "../plan.md"
        }
      ]
    })
  );
});
