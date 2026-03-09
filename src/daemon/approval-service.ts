import type { DatabaseSync } from "node:sqlite";

import type { ApprovalRecord } from "../storage/approval-store.js";
import type { PersistedDeliveryRecord } from "../storage/delivery-store.js";
import type { PersistedEventRecord } from "../storage/event-store.js";
import type { Dispatcher } from "./dispatcher.js";
import type {
  ReturnTypeOfCreateApprovalStore,
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore
} from "./types.js";

export interface ApprovalServiceOptions {
  readonly database: DatabaseSync;
  readonly approvalStore: ReturnTypeOfCreateApprovalStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly dispatcher: Dispatcher;
}

export interface ApproveEventInput {
  readonly approvalId: string;
  readonly decidedBy: string;
}

export interface RejectEventInput extends ApproveEventInput {
  readonly feedback?: string;
}

export interface ApprovalTransitionResult {
  readonly approval: ApprovalRecord;
  readonly event: PersistedEventRecord;
  readonly deliveries: PersistedDeliveryRecord[];
}

export function createApprovalService({
  database,
  approvalStore,
  eventStore,
  deliveryStore,
  dispatcher
}: ApprovalServiceOptions) {
  return {
    approve(input: ApproveEventInput): ApprovalTransitionResult {
      database.exec("BEGIN");

      let approval: ApprovalRecord;
      let event: PersistedEventRecord;
      let deliveries: PersistedDeliveryRecord[];

      try {
        approval = approvalStore.approve(
          {
            approvalId: input.approvalId,
            decidedBy: input.decidedBy
          },
          { skipTransaction: true }
        );
        event = eventStore.updateApprovalStatus(approval.eventId, "approved", {
          skipTransaction: true
        });
        deliveries = deliveryStore.transitionEventDeliveries(
          approval.eventId,
          "pending_approval",
          "ready",
          approval.decidedAt,
          { skipTransaction: true }
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      for (const delivery of deliveries) {
        if (delivery.status === "ready") {
          dispatcher.handleReadyDelivery(delivery);
        }
      }

      return { approval, event, deliveries };
    },

    reject(input: RejectEventInput): ApprovalTransitionResult {
      database.exec("BEGIN");

      let approval: ApprovalRecord;
      let event: PersistedEventRecord;
      let deliveries: PersistedDeliveryRecord[];

      try {
        approval = approvalStore.reject(
          {
            approvalId: input.approvalId,
            decidedBy: input.decidedBy,
            ...(input.feedback ? { feedback: input.feedback } : {})
          },
          { skipTransaction: true }
        );
        event = eventStore.updateApprovalStatus(approval.eventId, "rejected", {
          skipTransaction: true
        });
        deliveries = deliveryStore.transitionEventDeliveries(
          approval.eventId,
          "pending_approval",
          "cancelled",
          undefined,
          { skipTransaction: true }
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return { approval, event, deliveries };
    }
  };
}
