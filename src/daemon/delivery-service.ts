import type { PersistedDeliveryRecord } from "../storage/delivery-store.js";
import type { Dispatcher } from "./dispatcher.js";
import type {
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";

export interface DeliveryServiceOptions {
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly runStore: ReturnTypeOfCreateRunStore;
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

export interface DeadLetterDeliveryInput {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly errorMessage: string;
  readonly asOf?: string;
}

function touchRunForDelivery(
  eventStore: ReturnTypeOfCreateEventStore,
  runStore: ReturnTypeOfCreateRunStore,
  delivery: PersistedDeliveryRecord
): void {
  const event = eventStore.getEvent(delivery.eventId);

  if (!event) {
    throw new Error(`Failed to load event ${delivery.eventId} for delivery ${delivery.deliveryId}.`);
  }

  runStore.touchRun(event.runId);
}

export function createDeliveryService({
  deliveryStore,
  eventStore,
  runStore,
  dispatcher
}: DeliveryServiceOptions) {
  return {
    claim(input: ClaimDeliveryInput): PersistedDeliveryRecord | null {
      const delivery = deliveryStore.claimNextDelivery(input);

      if (delivery) {
        touchRunForDelivery(eventStore, runStore, delivery);
      }

      return delivery;
    },

    acknowledge(deliveryId: string, leaseToken: string): PersistedDeliveryRecord {
      const delivery = deliveryStore.acknowledgeDelivery({ deliveryId, leaseToken });

      touchRunForDelivery(eventStore, runStore, delivery);

      return delivery;
    },

    fail(input: FailDeliveryInput): PersistedDeliveryRecord {
      const delivery = deliveryStore.failDelivery(input);

      touchRunForDelivery(eventStore, runStore, delivery);

      return delivery;
    },

    deadLetter(input: DeadLetterDeliveryInput): PersistedDeliveryRecord {
      const delivery = deliveryStore.deadLetterDelivery(input);

      touchRunForDelivery(eventStore, runStore, delivery);

      return delivery;
    },

    reclaimExpired(asOf?: string): PersistedDeliveryRecord[] {
      const deliveries = deliveryStore.reclaimExpiredLeases(asOf);

      for (const delivery of deliveries) {
        touchRunForDelivery(eventStore, runStore, delivery);
      }

      return deliveries;
    }
  };
}
