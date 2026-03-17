import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it } from "node:test";

import { createApprovalService } from "../../src/daemon/approval-service.js";
import { createDashboardServer } from "../../src/daemon/dashboard-server.js";
import { createDispatcher } from "../../src/daemon/dispatcher.js";
import type { OperatorRunDetail, OperatorRunSummary } from "../../src/daemon/operator-service.js";

type MockOperatorService = {
  listRunSummaries(limit?: number): OperatorRunSummary[];
  getRunDetail(runId: string): OperatorRunDetail | null;
  listPendingApprovalViews(): Array<Record<string, unknown>>;
  listFailureDeliveries(): Array<Record<string, unknown>>;
};

function createMockOperatorService(): MockOperatorService {
  const runSummary: OperatorRunSummary = {
    runId: "run-001",
    status: "in_progress",
    metadata: {},
    createdAt: "2026-03-17T00:00:00Z",
    updatedAt: "2026-03-17T00:05:00Z",
    eventCount: 1,
    approvalCount: 1,
    deliveryCount: 1,
    deliveryStatusCounts: {
      pendingApproval: 1,
      ready: 0,
      leased: 0,
      retryScheduled: 0,
      completed: 0,
      deadLetter: 0,
      cancelled: 0,
      total: 1
    },
    latestEventAt: "2026-03-17T00:05:00Z"
  };
  const runDetail: OperatorRunDetail = {
    ...runSummary,
    events: [
      {
        eventId: "event-001",
        runId: "run-001",
        topic: "plan_done",
        correlationId: "run-001",
        dedupeKey: "plan_done:run-001",
        approvalStatus: "pending",
        producer: {
          agentId: "planner",
          runtime: "claude-code"
        },
        payload: {},
        payloadMetadata: {},
        occurredAt: "2026-03-17T00:05:00Z",
        createdAt: "2026-03-17T00:05:00Z",
        artifactRefs: []
      }
    ],
    approvals: [
      {
        approvalId: "approval-001",
        eventId: "event-001",
        topic: "plan_done",
        status: "pending",
        requestedAt: "2026-03-17T00:05:00Z"
      }
    ],
    deliveries: [
      {
        deliveryId: "delivery-001",
        eventId: "event-001",
        runId: "run-001",
        correlationId: "run-001",
        approvalStatus: "pending",
        eventOccurredAt: "2026-03-17T00:05:00Z",
        agentId: "developer_codex",
        topic: "plan_done",
        status: "pending_approval",
        availableAt: "2026-03-17T00:05:00Z",
        attemptCount: 0,
        maxAttempts: 3,
        replayCount: 0,
        createdAt: "2026-03-17T00:05:00Z",
        updatedAt: "2026-03-17T00:05:00Z"
      }
    ]
  };
  return {
    listRunSummaries(limit = 20): OperatorRunSummary[] {
      void limit;
      return [runSummary];
    },
    getRunDetail(runId: string): OperatorRunDetail | null {
      return runId === "run-001" ? runDetail : null;
    },
    listPendingApprovalViews(): Array<Record<string, unknown>> {
      return [
        {
          approvalId: "approval-001",
          eventId: "event-001",
          runId: "run-001",
          topic: "plan_done",
          status: "pending",
          requestedAt: "2026-03-17T00:05:00Z",
          producerAgentId: "planner",
          approvalStatus: "pending",
          deliveryCount: 1
        }
      ];
    },
    listFailureDeliveries(): Array<Record<string, unknown>> {
      return [
        {
          deliveryId: "delivery-failure-001",
          eventId: "event-002",
          runId: "run-001",
          topic: "plan_done",
          agentId: "developer_codex",
          status: "dead_letter",
          lastError: "boom",
          attemptCount: 3,
          maxAttempts: 3,
          replayCount: 0,
          producerAgentId: "planner",
          producerRuntime: "claude-code"
        }
      ];
    }
  };
}

async function readSseFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: InstanceType<typeof TextDecoder>
): Promise<{ event: string; data: string }> {
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error("SSE stream ended before frame.");
    }
    buffer += decoder.decode(value, { stream: true });
    const frameEnd = buffer.indexOf("\n\n");
    if (frameEnd === -1) {
      continue;
    }
    const frame = buffer.slice(0, frameEnd);
    const eventLine = frame.split("\n").find((line) => line.startsWith("event:"));
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    return {
      event: eventLine ? eventLine.slice("event:".length).trim() : "message",
      data: dataLine ? dataLine.slice("data:".length).trim() : ""
    };
  }
}

describe("dashboard server", () => {
  const operatorService = createMockOperatorService();
  const dashboardEmitter = new EventEmitter<{ dashboard: [Record<string, unknown>] }>();
  let server: Awaited<ReturnType<typeof createDashboardServer>> | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("starts and serves JSON APIs", async () => {
    server = await createDashboardServer({
      operatorService: operatorService as never,
      dashboardEmitter: dashboardEmitter as never
    });
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const runsResponse = await fetch(`${server.url}/api/runs`);
    assert.equal(runsResponse.status, 200);
    const runs = (await runsResponse.json()) as Array<Record<string, unknown>>;
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.runId, "run-001");

    const detailResponse = await fetch(`${server.url}/api/runs/run-001`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    assert.equal(detail.runId, "run-001");

    const missingResponse = await fetch(`${server.url}/api/runs/missing`);
    assert.equal(missingResponse.status, 404);
    assert.equal((await (await fetch(`${server.url}/api/approvals`)).json() as unknown[]).length, 1);
    assert.equal((await (await fetch(`${server.url}/api/failures`)).json() as unknown[]).length, 1);
  });

  it("serves inline dashboard HTML", async () => {
    server = await createDashboardServer({
      operatorService: operatorService as never,
      dashboardEmitter: dashboardEmitter as never
    });
    const response = await fetch(`${server.url}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /EventSource\(\"\/events\"\)/);
    assert.match(html, /#4ade80/);
    assert.match(html, /#f87171/);
    assert.equal(html.includes("<script src="), false);
    assert.equal(html.includes("<link rel=\"stylesheet\" href="), false);
    assert.match(html, /const escapeHtml =/);
    assert.match(html, /const escapeAttr =/);
  });

  it("streams snapshot and relays dashboard events", async () => {
    server = await createDashboardServer({
      operatorService: operatorService as never,
      dashboardEmitter: dashboardEmitter as never
    });
    const response = await fetch(`${server.url}/events`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.ok(response.body);

    const reader = response.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();

    const snapshot = await readSseFrame(reader!, decoder);
    assert.equal(snapshot.event, "snapshot");
    const snapshotPayload = JSON.parse(snapshot.data) as Record<string, unknown>;
    assert.ok(Array.isArray(snapshotPayload.runs));

    dashboardEmitter.emit("dashboard", {
      type: "event.published",
      payload: {
        eventId: "event-200",
        runId: "run-001",
        topic: "plan_done"
      }
    });
    const relayed = await readSseFrame(reader!, decoder);
    assert.equal(relayed.event, "event.published");
    assert.equal((JSON.parse(relayed.data) as { eventId: string }).eventId, "event-200");
    await reader?.cancel();
  });

  it("stop resolves with open SSE connections", async () => {
    server = await createDashboardServer({
      operatorService: operatorService as never,
      dashboardEmitter: dashboardEmitter as never
    });
    const response = await fetch(`${server.url}/events`);
    assert.equal(response.status, 200);

    await assert.doesNotReject(
      Promise.race([
        server.stop(),
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("stop timed out")), 1000);
        })
      ])
    );
    server = null;
  });

  it("removes dashboard listeners when SSE clients disconnect", async () => {
    server = await createDashboardServer({
      operatorService: operatorService as never,
      dashboardEmitter: dashboardEmitter as never
    });
    assert.equal(dashboardEmitter.listenerCount("dashboard"), 0);

    const abortController = new AbortController();
    const response = await fetch(`${server.url}/events`, {
      signal: abortController.signal
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(dashboardEmitter.listenerCount("dashboard"), 1);

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(dashboardEmitter.listenerCount("dashboard"), 0);
  });

  it("limits concurrent SSE clients", async () => {
    server = await createDashboardServer({
      operatorService: operatorService as never,
      dashboardEmitter: dashboardEmitter as never,
      maxSseConnections: 1
    });

    const first = await fetch(`${server.url}/events`);
    assert.equal(first.status, 200);

    const second = await fetch(`${server.url}/events`);
    assert.equal(second.status, 429);
    const payload = (await second.json()) as { error?: string };
    assert.equal(payload.error, "too many active dashboard event streams");

    await first.body?.cancel();
  });
});

describe("dispatcher dashboard events", () => {
  it("emits typed dashboard events while preserving snapshot behavior", () => {
    const dispatcher = createDispatcher();
    const events: string[] = [];
    let deliveryPayload: Record<string, unknown> | null = null;
    dispatcher.dashboardEmitter.on("dashboard", (event) => {
      events.push(event.type);
      if (event.type === "delivery.state_changed") {
        deliveryPayload = event.payload;
      }
    });

    dispatcher.handlePersistedEvent({
      eventId: "event-101",
      runId: "run-101",
      topic: "plan_done",
      correlationId: "run-101",
      dedupeKey: "plan_done:run-101",
      approvalStatus: "not_required",
      producer: {
        agentId: "planner",
        runtime: "claude-code"
      },
      payload: {},
      payloadMetadata: {},
      occurredAt: "2026-03-17T01:00:00Z",
      createdAt: "2026-03-17T01:00:00Z",
      artifactRefs: []
    });
    dispatcher.handlePendingApproval({
      approvalId: "approval-101",
      eventId: "event-101",
      runId: "run-101",
      topic: "plan_done",
      status: "pending",
      requestedAt: "2026-03-17T01:00:00Z"
    });
    dispatcher.handleReadyDelivery({
      deliveryId: "delivery-101",
      eventId: "event-101",
      agentId: "developer_codex",
      topic: "plan_done",
      status: "ready",
      availableAt: "2026-03-17T01:00:00Z",
      attemptCount: 0,
      maxAttempts: 3,
      replayCount: 0,
      createdAt: "2026-03-17T01:00:00Z",
      updatedAt: "2026-03-17T01:00:00Z"
    }, "run-101");

    assert.equal(dispatcher.snapshot().length, 3);
    assert.deepEqual(events, ["event.published", "approval.created", "delivery.state_changed"]);
    assert.equal(deliveryPayload?.["runId"], "run-101");
    assert.equal(deliveryPayload?.["oldState"], null);
    assert.equal(deliveryPayload?.["newState"], "ready");
  });
});

describe("approval service dashboard events", () => {
  it("emits approval.decided on approve and reject", () => {
    const dispatcher = createDispatcher();
    const emitted: string[] = [];
    dispatcher.dashboardEmitter.on("dashboard", (event) => {
      emitted.push(event.type);
    });

    const service = createApprovalService({
      database: { exec() {} } as never,
      approvalStore: {
        approve() {
          return {
            approvalId: "approval-201",
            eventId: "event-201",
            topic: "plan_done",
            status: "approved",
            requestedAt: "2026-03-17T01:30:00Z",
            decidedAt: "2026-03-17T01:31:00Z",
            decidedBy: "human"
          };
        },
        reject() {
          return {
            approvalId: "approval-202",
            eventId: "event-202",
            topic: "plan_done",
            status: "rejected",
            requestedAt: "2026-03-17T01:30:00Z",
            decidedAt: "2026-03-17T01:31:00Z",
            decidedBy: "human"
          };
        }
      } as never,
      eventStore: {
        updateApprovalStatus(eventId: string) {
          return {
            eventId,
            runId: "run-201",
            topic: "plan_done",
            correlationId: "run-201",
            dedupeKey: `plan_done:${eventId}`,
            approvalStatus: "approved",
            producer: {
              agentId: "planner",
              runtime: "claude-code"
            },
            payload: {},
            payloadMetadata: {},
            occurredAt: "2026-03-17T01:30:00Z",
            createdAt: "2026-03-17T01:30:00Z",
            artifactRefs: []
          };
        }
      } as never,
      deliveryStore: {
        transitionEventDeliveries(_eventId: string, _from: string, to: string) {
          if (to === "ready") {
            return [
              {
                deliveryId: "delivery-201",
                eventId: "event-201",
                runId: "run-201",
                agentId: "developer_codex",
                topic: "plan_done",
                status: "ready",
                availableAt: "2026-03-17T01:30:00Z",
                attemptCount: 0,
                maxAttempts: 3,
                replayCount: 0,
                createdAt: "2026-03-17T01:30:00Z",
                updatedAt: "2026-03-17T01:30:00Z"
              }
            ];
          }
          return [];
        }
      } as never,
      runStore: { touchRun() {} } as never,
      dispatcher
    });

    service.approve({ approvalId: "approval-201", decidedBy: "human" });
    service.reject({ approvalId: "approval-202", decidedBy: "human" });

    assert.ok(emitted.includes("approval.decided"));
    assert.ok(emitted.includes("delivery.state_changed"));
  });
});
