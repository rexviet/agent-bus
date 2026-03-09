import type { PersistedDeliveryRecord } from "../storage/delivery-store.js";
import type { Dispatcher } from "./dispatcher.js";
import type { ReturnTypeOfCreateDeliveryStore } from "./types.js";

export interface DeliveryServiceOptions {
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly dispatcher: Dispatcher;
}

export interface ClaimDeliveryInput {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly asOf?: string;
}

export interface FailDeliveryInput {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly errorMessage: string;
  readonly retryDelayMs: number;
  readonly asOf?: string;
}

export function createDeliveryService({
  deliveryStore,
  dispatcher
}: DeliveryServiceOptions) {
  return {
    claim(input: ClaimDeliveryInput): PersistedDeliveryRecord | null {
      return deliveryStore.claimNextDelivery(input);
    },

    acknowledge(deliveryId: string, leaseToken: string): PersistedDeliveryRecord {
      return deliveryStore.acknowledgeDelivery({ deliveryId, leaseToken });
    },

    fail(input: FailDeliveryInput): PersistedDeliveryRecord {
      return deliveryStore.failDelivery(input);
    },

    reclaimExpired(asOf?: string): PersistedDeliveryRecord[] {
      return deliveryStore.reclaimExpiredLeases(asOf);
    }
  };
}
