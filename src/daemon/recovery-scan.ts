import type {
  ReturnTypeOfCreateApprovalStore,
  ReturnTypeOfCreateDeliveryStore
} from "./types.js";
import type { Dispatcher } from "./dispatcher.js";

export interface RecoveryScanOptions {
  readonly approvalStore: ReturnTypeOfCreateApprovalStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly dispatcher: Dispatcher;
  readonly intervalMs?: number;
}

export function createRecoveryScan({
  approvalStore,
  deliveryStore,
  dispatcher,
  intervalMs = 15_000
}: RecoveryScanOptions) {
  let timer: NodeJS.Timeout | null = null;

  function runOnce(): number {
    const pendingApprovals = approvalStore.listPendingApprovals();
    const readyDeliveries = deliveryStore.listReadyDeliveries();

    for (const approval of pendingApprovals) {
      dispatcher.handlePendingApproval(approval);
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
