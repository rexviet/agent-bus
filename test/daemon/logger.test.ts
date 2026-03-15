import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDaemonLogger,
  type DaemonLogDestination
} from "../../src/daemon/logger.js";

function createCaptureDestination(): {
  readonly destination: DaemonLogDestination;
  readLines(): string[];
} {
  let output = "";

  return {
    destination: {
      write(message: string): void {
        output += message;
      }
    },
    readLines(): string[] {
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }
  };
}

test("createDaemonLogger defaults to info level", () => {
  const capture = createCaptureDestination();
  const logger = createDaemonLogger(undefined, capture.destination);

  assert.equal(logger.level, "info");
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.error, "function");
  assert.equal(typeof logger.child, "function");
});

test("createDaemonLogger honors the provided level", () => {
  const capture = createCaptureDestination();
  const logger = createDaemonLogger("error", capture.destination);

  assert.equal(logger.level, "error");
});

test("createDaemonLogger writes NDJSON to the provided destination", () => {
  const capture = createCaptureDestination();
  const logger = createDaemonLogger("info", capture.destination);

  logger.info({
    event: "delivery.claimed",
    deliveryId: "delivery-123",
    agentId: "agent-123",
    runId: "run-123"
  });

  const [line] = capture.readLines();

  assert.ok(line, "expected one log line to be written");

  const parsed = JSON.parse(line) as Record<string, unknown>;

  assert.equal(parsed.event, "delivery.claimed");
  assert.equal(parsed.deliveryId, "delivery-123");
  assert.equal(parsed.agentId, "agent-123");
  assert.equal(parsed.runId, "run-123");
  assert.equal(typeof parsed.level, "number");
  assert.equal(typeof parsed.timestamp, "string");
});
