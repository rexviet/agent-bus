import type { PersistedDeliveryRecord } from "../storage/delivery-store.js";
import type { PersistedEventRecord } from "../storage/event-store.js";
import type { Dispatcher } from "./dispatcher.js";
import type {
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";

export interface ReplayServiceOptions {
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly runStore: ReturnTypeOfCreateRunStore;
  readonly dispatcher: Dispatcher;
}

export interface ReplayEventResult {
  readonly event: PersistedEventRecord;
  readonly deliveries: PersistedDeliveryRecord[];
}

function requireReplayableEvent(event: PersistedEventRecord): PersistedEventRecord {
  if (event.approvalStatus === "pending" || event.approvalStatus === "rejected") {
    throw new Error(
      `Replay requires an event with approved or not_required approval status for ${event.eventId}.`
    );
  }

  return event;
}

export function createReplayService({
  eventStore,
  deliveryStore,
  runStore,
  dispatcher
}: ReplayServiceOptions) {
  return {
    replayDelivery(deliveryId: string, availableAt?: string): PersistedDeliveryRecord {
      const currentDelivery = deliveryStore.getDelivery(deliveryId);

      if (!currentDelivery) {
        throw new Error(`Replay requires an existing delivery for ${deliveryId}.`);
      }

      const event = eventStore.getEvent(currentDelivery.eventId);

      if (!event) {
        throw new Error(`Replay requires an existing event for ${currentDelivery.eventId}.`);
      }

      requireReplayableEvent(event);

      const delivery = deliveryStore.replayDelivery({
        deliveryId,
        ...(availableAt ? { availableAt } : {})
      });

      runStore.touchRun(event.runId);
      dispatcher.handleReadyDelivery(delivery);

      return delivery;
    },

    replayEvent(eventId: string, availableAt?: string): ReplayEventResult {
      const event = eventStore.getEvent(eventId);

      if (!event) {
        throw new Error(`Replay requires an existing event for ${eventId}.`);
      }

      requireReplayableEvent(event);

      const deliveries = deliveryStore.replayEventDeliveries(
        eventId,
        availableAt
      );

      runStore.touchRun(event.runId);
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
