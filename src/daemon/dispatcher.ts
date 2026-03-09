import type { PendingApprovalRecord, PersistedEventRecord } from "../storage/event-store.js";

export type DispatchState = "approval_pending" | "ready_for_delivery";

export interface DispatchNotification {
  readonly eventId: string;
  readonly topic: string;
  readonly state: DispatchState;
  readonly recordedAt: string;
}

function createNotificationKey(notification: DispatchNotification): string {
  return `${notification.state}:${notification.eventId}`;
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
        recordedAt: new Date().toISOString()
      });
    },

    snapshot(): DispatchNotification[] {
      return [...notifications];
    }
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
