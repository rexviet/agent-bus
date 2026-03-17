import type { PersistedDeliveryRecord } from "../storage/delivery-store.js";
import type { PendingApprovalRecord, PersistedEventRecord } from "../storage/event-store.js";

export type DispatchState = "approval_pending" | "ready_for_delivery";

export interface DispatchNotification {
  readonly eventId: string;
  readonly topic: string;
  readonly state: DispatchState;
  readonly recordedAt: string;
  readonly approvalId?: string;
  readonly deliveryId?: string;
  readonly agentId?: string;
  readonly deliveryStatus?: PersistedDeliveryRecord["status"];
  readonly attemptCount?: number;
  readonly replayCount?: number;
  readonly availableAt?: string;
}

function createNotificationKey(notification: DispatchNotification): string {
  return notification.state === "ready_for_delivery"
    ? `${notification.state}:${notification.deliveryId ?? notification.eventId}:${
        notification.deliveryStatus ?? "unknown"
      }:${notification.attemptCount ?? 0}:${notification.replayCount ?? 0}:${
        notification.availableAt ?? "unknown"
      }`
    : `${notification.state}:${notification.eventId}`;
}

export function createDispatcher() {
  const notifications: DispatchNotification[] = [];
  const seenNotificationKeys = new Set<string>();

  function recordNotification(notification: DispatchNotification): DispatchNotification {
    const notificationKey = createNotificationKey(notification);

    if (!seenNotificationKeys.has(notificationKey)) {
      seenNotificationKeys.add(notificationKey);
      notifications.push(notification);
    }

    return notification;
  }

  return {
    handlePersistedEvent(event: PersistedEventRecord): DispatchNotification {
      return recordNotification({
        eventId: event.eventId,
        topic: event.topic,
        state: event.approvalStatus === "pending" ? "approval_pending" : "ready_for_delivery",
        recordedAt: new Date().toISOString()
      });
    },

    handlePendingApproval(approval: PendingApprovalRecord): DispatchNotification {
      return recordNotification({
        eventId: approval.eventId,
        topic: approval.topic,
        state: "approval_pending",
        approvalId: approval.approvalId,
        recordedAt: new Date().toISOString()
      });
    },

    handleReadyDelivery(delivery: PersistedDeliveryRecord): DispatchNotification {
      return recordNotification({
        eventId: delivery.eventId,
        topic: delivery.topic,
        state: "ready_for_delivery",
        deliveryId: delivery.deliveryId,
        agentId: delivery.agentId,
        deliveryStatus: delivery.status,
        attemptCount: delivery.attemptCount,
        replayCount: delivery.replayCount,
        availableAt: delivery.availableAt,
        recordedAt: new Date().toISOString()
      });
    },

    snapshot(): DispatchNotification[] {
      return [...notifications];
    }
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
