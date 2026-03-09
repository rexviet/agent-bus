import type { PersistedDeliveryRecord } from "../storage/delivery-store.js";
import type { PersistedEventRecord } from "../storage/event-store.js";
import type { Dispatcher } from "./dispatcher.js";
import type {
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore
} from "./types.js";

export interface ReplayServiceOptions {
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly dispatcher: Dispatcher;
}

export interface ReplayEventResult {
  readonly event: PersistedEventRecord;
  readonly deliveries: PersistedDeliveryRecord[];
}

export function createReplayService({
  eventStore,
  deliveryStore,
  dispatcher
}: ReplayServiceOptions) {
  return {
    replayDelivery(deliveryId: string, availableAt?: string): PersistedDeliveryRecord {
      const delivery = deliveryStore.replayDelivery({
        deliveryId,
        ...(availableAt ? { availableAt } : {})
      });

      dispatcher.handleReadyDelivery(delivery);

      return delivery;
    },

    replayEvent(eventId: string, availableAt?: string): ReplayEventResult {
      const event = eventStore.getEvent(eventId);

      if (!event) {
        throw new Error(`Replay requires an existing event for ${eventId}.`);
      }

      const deliveries = deliveryStore.replayEventDeliveries(
        eventId,
        availableAt
      );

      for (const delivery of deliveries) {
        dispatcher.handleReadyDelivery(delivery);
      }

      return {
        event,
        deliveries
      };
    }
  };
}
