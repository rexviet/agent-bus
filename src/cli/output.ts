import type {
  FailureDeliveryView,
  OperatorRunDetail,
  OperatorRunSummary,
  PendingApprovalView
} from "../daemon/operator-service.js";

export interface WritableTextStream {
  write(chunk: string): boolean;
}

function writeLine(stream: WritableTextStream, line = ""): void {
  stream.write(`${line}\n`);
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatRunSummary(summary: OperatorRunSummary): string {
  return (
    `- ${summary.runId} ` +
    `status=${summary.status} events=${summary.eventCount} approvals=${summary.approvalCount} ` +
    `deliveries=${summary.deliveryCount} ` +
    `pendingApproval=${summary.deliveryStatusCounts.pendingApproval} ` +
    `ready=${summary.deliveryStatusCounts.ready} leased=${summary.deliveryStatusCounts.leased} ` +
    `retryScheduled=${summary.deliveryStatusCounts.retryScheduled} ` +
    `completed=${summary.deliveryStatusCounts.completed} deadLetter=${summary.deliveryStatusCounts.deadLetter} ` +
    `cancelled=${summary.deliveryStatusCounts.cancelled}` +
    (summary.latestEventAt ? ` latestEventAt=${summary.latestEventAt}` : "")
  );
}

export function writeJson(
  stream: WritableTextStream,
  value: unknown
): void {
  writeLine(stream, stringify(value));
}

export function writeRunSummariesText(
  stream: WritableTextStream,
  summaries: readonly OperatorRunSummary[]
): void {
  writeLine(stream, `Runs (${summaries.length})`);

  if (summaries.length === 0) {
    writeLine(stream, "No runs found.");
    return;
  }

  for (const summary of summaries) {
    writeLine(stream, formatRunSummary(summary));
  }
}

export function writeRunDetailText(
  stream: WritableTextStream,
  detail: OperatorRunDetail
): void {
  writeLine(stream, `Run ${detail.runId}`);
  writeLine(stream, `status: ${detail.status}`);
  writeLine(stream, `events: ${detail.eventCount}`);
  writeLine(stream, `approvals: ${detail.approvalCount}`);
  writeLine(stream, `deliveries: ${detail.deliveryCount}`);
  writeLine(stream, `createdAt: ${detail.createdAt}`);
  writeLine(stream, `updatedAt: ${detail.updatedAt}`);

  writeLine(stream);
  writeLine(stream, "Events:");

  if (detail.events.length === 0) {
    writeLine(stream, "- none");
  } else {
    for (const event of detail.events) {
      writeLine(
        stream,
        `- ${event.eventId} topic=${event.topic} occurredAt=${event.occurredAt} approval=${event.approvalStatus} producer=${event.producer.agentId}`
      );
    }
  }

  writeLine(stream);
  writeLine(stream, "Approvals:");

  if (detail.approvals.length === 0) {
    writeLine(stream, "- none");
  } else {
    for (const approval of detail.approvals) {
      writeLine(
        stream,
        `- ${approval.approvalId} status=${approval.status} requestedAt=${approval.requestedAt}` +
          (approval.decidedBy ? ` decidedBy=${approval.decidedBy}` : "") +
          (approval.feedback ? ` feedback=${approval.feedback}` : "")
      );
    }
  }

  writeLine(stream);
  writeLine(stream, "Deliveries:");

  if (detail.deliveries.length === 0) {
    writeLine(stream, "- none");
    return;
  }

  for (const delivery of detail.deliveries) {
    writeLine(
      stream,
      `- ${delivery.deliveryId} event=${delivery.eventId} agent=${delivery.agentId} status=${delivery.status} attempts=${delivery.attemptCount}/${delivery.maxAttempts} replay=${delivery.replayCount}` +
        (delivery.lastError ? ` error=${delivery.lastError}` : "")
    );
  }
}

export function writePendingApprovalsText(
  stream: WritableTextStream,
  approvals: readonly PendingApprovalView[]
): void {
  writeLine(stream, `Pending approvals (${approvals.length})`);

  if (approvals.length === 0) {
    writeLine(stream, "No pending approvals.");
    return;
  }

  for (const approval of approvals) {
    writeLine(
      stream,
      `- ${approval.approvalId} run=${approval.runId} event=${approval.eventId} topic=${approval.topic} requestedAt=${approval.requestedAt} producer=${approval.producerAgentId} deliveries=${approval.deliveryCount}`
    );
  }
}

export function writeFailureDeliveriesText(
  stream: WritableTextStream,
  failures: readonly FailureDeliveryView[]
): void {
  writeLine(stream, `Failures (${failures.length})`);

  if (failures.length === 0) {
    writeLine(stream, "No failure deliveries found.");
    return;
  }

  for (const failure of failures) {
    writeLine(
      stream,
      `- ${failure.deliveryId} run=${failure.runId} event=${failure.eventId} agent=${failure.agentId} status=${failure.status} attempts=${failure.attemptCount}/${failure.maxAttempts} replay=${failure.replayCount} error=${failure.lastError ?? "unknown"}`
    );
  }
}

export function writeApprovalDecisionText(
  stream: WritableTextStream,
  result: {
    readonly approval: {
      readonly approvalId: string;
      readonly status: string;
      readonly decidedBy?: string;
      readonly feedback?: string;
    };
    readonly event: {
      readonly eventId: string;
      readonly runId: string;
      readonly approvalStatus: string;
    };
    readonly deliveries: readonly {
      readonly deliveryId: string;
      readonly status: string;
    }[];
  }
): void {
  writeLine(stream, `Approval ${result.approval.approvalId}`);
  writeLine(stream, `status: ${result.approval.status}`);
  writeLine(stream, `eventId: ${result.event.eventId}`);
  writeLine(stream, `runId: ${result.event.runId}`);
  writeLine(stream, `approvalStatus: ${result.event.approvalStatus}`);

  if (result.approval.decidedBy) {
    writeLine(stream, `decidedBy: ${result.approval.decidedBy}`);
  }

  if (result.approval.feedback) {
    writeLine(stream, `feedback: ${result.approval.feedback}`);
  }

  writeLine(stream, `deliveries: ${result.deliveries.length}`);

  for (const delivery of result.deliveries) {
    writeLine(stream, `- ${delivery.deliveryId} status=${delivery.status}`);
  }
}

export function writeReplayResultText(
  stream: WritableTextStream,
  result:
    | {
        readonly event: {
          readonly eventId: string;
          readonly runId: string;
        };
        readonly deliveries: readonly {
          readonly deliveryId: string;
          readonly status: string;
          readonly replayCount: number;
        }[];
      }
    | {
        readonly deliveryId: string;
        readonly eventId: string;
        readonly status: string;
        readonly replayCount: number;
      }
): void {
  if ("deliveryId" in result) {
    writeLine(stream, `Replayed delivery ${result.deliveryId}`);
    writeLine(stream, `eventId: ${result.eventId}`);
    writeLine(stream, `status: ${result.status}`);
    writeLine(stream, `replayCount: ${result.replayCount}`);
    return;
  }

  writeLine(stream, `Replayed event ${result.event.eventId}`);
  writeLine(stream, `runId: ${result.event.runId}`);
  writeLine(stream, `deliveries: ${result.deliveries.length}`);

  for (const delivery of result.deliveries) {
    writeLine(
      stream,
      `- ${delivery.deliveryId} status=${delivery.status} replay=${delivery.replayCount}`
    );
  }
}

export function writePublishedEventText(
  stream: WritableTextStream,
  event: {
    readonly eventId: string;
    readonly runId: string;
    readonly topic: string;
    readonly approvalStatus: string;
  }
): void {
  writeLine(stream, `Published event ${event.eventId}`);
  writeLine(stream, `runId: ${event.runId}`);
  writeLine(stream, `topic: ${event.topic}`);
  writeLine(stream, `approvalStatus: ${event.approvalStatus}`);
}
