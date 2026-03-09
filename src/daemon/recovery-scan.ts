import type { Dispatcher } from "./dispatcher.js";
import type { ReturnTypeOfCreateEventStore } from "./types.js";

export interface RecoveryScanOptions {
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly dispatcher: Dispatcher;
  readonly intervalMs?: number;
}

export function createRecoveryScan({
  eventStore,
  dispatcher,
  intervalMs = 15_000
}: RecoveryScanOptions) {
  let timer: NodeJS.Timeout | null = null;

  function runOnce(): number {
    const pendingApprovals = eventStore.listPendingApprovals();

    for (const approval of pendingApprovals) {
      dispatcher.handlePendingApproval(approval);
    }

    return pendingApprovals.length;
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
