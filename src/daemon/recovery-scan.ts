import type {
  ReturnTypeOfCreateApprovalStore,
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";
import { createDeliveryService } from "./delivery-service.js";
import type { Dispatcher } from "./dispatcher.js";

export interface RecoveryScanOptions {
  readonly approvalStore: ReturnTypeOfCreateApprovalStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly runStore: ReturnTypeOfCreateRunStore;
  readonly dispatcher: Dispatcher;
  readonly intervalMs?: number;
}

export function createRecoveryScan({
  approvalStore,
  deliveryStore,
  eventStore,
  runStore,
  dispatcher,
  intervalMs = 15_000
}: RecoveryScanOptions) {
  let timer: NodeJS.Timeout | null = null;
  const deliveryService = createDeliveryService({
    deliveryStore,
    eventStore,
    runStore,
    dispatcher
  });

  function runOnce(): number {
    const pendingApprovals = approvalStore.listPendingApprovals();
    deliveryService.reclaimExpired();
    const readyDeliveries = deliveryStore.listReadyDeliveries();

    for (const approval of pendingApprovals) {
      const event = eventStore.getEvent(approval.eventId);

      if (!event) {
        continue;
      }

      dispatcher.handlePendingApproval({
        approvalId: approval.approvalId,
        eventId: approval.eventId,
        runId: event.runId,
        topic: approval.topic,
        status: approval.status,
        requestedAt: approval.requestedAt
      });
    }

    for (const delivery of readyDeliveries) {
      dispatcher.handleReadyDelivery(delivery);
    }

    return pendingApprovals.length + readyDeliveries.length;
  }

  return {
    runOnce,

    start(): void {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        runOnce();
      }, intervalMs);

      timer.unref?.();
    },

    stop(): void {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
    }
  };
}
