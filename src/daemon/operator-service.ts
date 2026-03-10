import type { ApprovalRecord } from "../storage/approval-store.js";
import type {
  DeliveryStatus,
  DeliveryWithEventRecord
} from "../storage/delivery-store.js";
import type { PersistedEventRecord } from "../storage/event-store.js";
import type { RunRecord, RunStatus } from "../storage/run-store.js";
import type {
  ReturnTypeOfCreateApprovalStore,
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";

export type OperatorRunStatus =
  | RunStatus
  | "awaiting_approval"
  | "attention_required"
  | "in_progress";

export interface OperatorDeliveryStatusCounts {
  readonly pendingApproval: number;
  readonly ready: number;
  readonly leased: number;
  readonly retryScheduled: number;
  readonly completed: number;
  readonly deadLetter: number;
  readonly cancelled: number;
  readonly total: number;
}

export interface OperatorRunSummary {
  readonly runId: string;
  readonly status: OperatorRunStatus;
  readonly metadata: RunRecord["metadata"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly eventCount: number;
  readonly approvalCount: number;
  readonly deliveryCount: number;
  readonly deliveryStatusCounts: OperatorDeliveryStatusCounts;
  readonly latestEventAt?: string;
}

export interface OperatorRunDetail extends OperatorRunSummary {
  readonly events: PersistedEventRecord[];
  readonly approvals: ApprovalRecord[];
  readonly deliveries: DeliveryWithEventRecord[];
}

export interface PendingApprovalView {
  readonly approvalId: string;
  readonly eventId: string;
  readonly runId: string;
  readonly topic: string;
  readonly status: ApprovalRecord["status"];
  readonly requestedAt: string;
  readonly producerAgentId: string;
  readonly approvalStatus: PersistedEventRecord["approvalStatus"];
  readonly deliveryCount: number;
}

export interface FailureDeliveryView extends DeliveryWithEventRecord {
  readonly producerAgentId: string;
  readonly producerRuntime: string;
}

export interface CreateOperatorServiceOptions {
  readonly runStore: ReturnTypeOfCreateRunStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly approvalStore: ReturnTypeOfCreateApprovalStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
}

function buildDeliveryStatusCounts(
  deliveries: readonly { status: DeliveryStatus }[]
): OperatorDeliveryStatusCounts {
  const counts = {
    pendingApproval: 0,
    ready: 0,
    leased: 0,
    retryScheduled: 0,
    completed: 0,
    deadLetter: 0,
    cancelled: 0,
    total: deliveries.length
  };

  for (const delivery of deliveries) {
    switch (delivery.status) {
      case "pending_approval":
        counts.pendingApproval += 1;
        break;
      case "ready":
        counts.ready += 1;
        break;
      case "leased":
        counts.leased += 1;
        break;
      case "retry_scheduled":
        counts.retryScheduled += 1;
        break;
      case "completed":
        counts.completed += 1;
        break;
      case "dead_letter":
        counts.deadLetter += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
    }
  }

  return counts;
}

function deriveRunStatus(
  run: RunRecord,
  approvals: readonly ApprovalRecord[],
  deliveries: readonly DeliveryWithEventRecord[]
): OperatorRunStatus {
  if (approvals.some((approval) => approval.status === "pending")) {
    return "awaiting_approval";
  }

  if (deliveries.some((delivery) => delivery.status === "dead_letter")) {
    return "attention_required";
  }

  if (deliveries.some((delivery) => delivery.status === "retry_scheduled")) {
    return "attention_required";
  }

  if (
    deliveries.some((delivery) =>
      ["pending_approval", "ready", "leased"].includes(delivery.status)
    )
  ) {
    return "in_progress";
  }

  if (
    deliveries.length > 0 &&
    deliveries.every((delivery) => delivery.status === "cancelled")
  ) {
    return "cancelled";
  }

  if (
    deliveries.length > 0 &&
    deliveries.every((delivery) =>
      ["completed", "cancelled"].includes(delivery.status)
    )
  ) {
    return "completed";
  }

  return run.status;
}

function buildRunSummary(
  run: RunRecord,
  events: readonly PersistedEventRecord[],
  approvals: readonly ApprovalRecord[],
  deliveries: readonly DeliveryWithEventRecord[]
): OperatorRunSummary {
  const latestEventAt =
    events.length > 0 ? events[events.length - 1]?.occurredAt : undefined;

  return {
    runId: run.runId,
    status: deriveRunStatus(run, approvals, deliveries),
    metadata: run.metadata,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    eventCount: events.length,
    approvalCount: approvals.length,
    deliveryCount: deliveries.length,
    deliveryStatusCounts: buildDeliveryStatusCounts(deliveries),
    ...(latestEventAt ? { latestEventAt } : {})
  };
}

function buildRunDetail(
  run: RunRecord,
  events: readonly PersistedEventRecord[],
  approvals: readonly ApprovalRecord[],
  deliveries: readonly DeliveryWithEventRecord[]
): OperatorRunDetail {
  return {
    ...buildRunSummary(run, events, approvals, deliveries),
    events: [...events],
    approvals: [...approvals],
    deliveries: [...deliveries]
  };
}

export function createOperatorService({
  runStore,
  eventStore,
  approvalStore,
  deliveryStore
}: CreateOperatorServiceOptions) {
  return {
    listRunSummaries(limit = 20): OperatorRunSummary[] {
      return runStore.listRuns({ limit }).map((run) => {
        const events = eventStore.listEventsForRun(run.runId);
        const deliveries = deliveryStore.listDeliveriesForRun(run.runId);
        const approvals = events
          .map((event) => approvalStore.getApprovalForEvent(event.eventId))
          .filter((approval): approval is ApprovalRecord => approval !== null);

        return buildRunSummary(run, events, approvals, deliveries);
      });
    },

    getRunDetail(runId: string): OperatorRunDetail | null {
      const run = runStore.getRun(runId);

      if (!run) {
        return null;
      }

      const events = eventStore.listEventsForRun(run.runId);
      const deliveries = deliveryStore.listDeliveriesForRun(run.runId);
      const approvals = events
        .map((event) => approvalStore.getApprovalForEvent(event.eventId))
        .filter((approval): approval is ApprovalRecord => approval !== null);

      return buildRunDetail(run, events, approvals, deliveries);
    },

    listPendingApprovalViews(): PendingApprovalView[] {
      return approvalStore.listPendingApprovals().map((approval) => {
        const event = eventStore.getEvent(approval.eventId);

        if (!event) {
          throw new Error(`Failed to load event ${approval.eventId} for approval ${approval.approvalId}.`);
        }

        return {
          approvalId: approval.approvalId,
          eventId: approval.eventId,
          runId: event.runId,
          topic: approval.topic,
          status: approval.status,
          requestedAt: approval.requestedAt,
          producerAgentId: event.producer.agentId,
          approvalStatus: event.approvalStatus,
          deliveryCount: deliveryStore.listDeliveriesForEvent(approval.eventId).length
        };
      });
    },

    listFailureDeliveries(): FailureDeliveryView[] {
      return deliveryStore.listFailureDeliveries().map((delivery) => {
        const event = eventStore.getEvent(delivery.eventId);

        if (!event) {
          throw new Error(`Failed to load event ${delivery.eventId} for delivery ${delivery.deliveryId}.`);
        }

        return {
          ...delivery,
          producerAgentId: event.producer.agentId,
          producerRuntime: event.producer.runtime
        };
      });
    }
  };
}
