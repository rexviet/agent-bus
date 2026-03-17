import { EventEmitter } from "node:events";

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

export type DashboardEventType =
  | "delivery.state_changed"
  | "approval.created"
  | "approval.decided"
  | "event.published";

export interface DashboardEvent {
  readonly type: DashboardEventType;
  readonly payload: Record<string, unknown>;
}

export type DashboardEmitter = EventEmitter<{ dashboard: [DashboardEvent] }>;

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
  const dashboardEmitter: DashboardEmitter = new EventEmitter();

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
      const notification = recordNotification({
        eventId: event.eventId,
        topic: event.topic,
        state: event.approvalStatus === "pending" ? "approval_pending" : "ready_for_delivery",
        recordedAt: new Date().toISOString()
      });

      dashboardEmitter.emit("dashboard", {
        type: "event.published",
        payload: {
          eventId: event.eventId,
          runId: event.runId,
          topic: event.topic
        }
      });

      return notification;
    },

    handlePendingApproval(approval: PendingApprovalRecord): DispatchNotification {
      const notification = recordNotification({
        eventId: approval.eventId,
        topic: approval.topic,
        state: "approval_pending",
        approvalId: approval.approvalId,
        recordedAt: new Date().toISOString()
      });

      dashboardEmitter.emit("dashboard", {
        type: "approval.created",
        payload: {
          approvalId: approval.approvalId,
          eventId: approval.eventId,
          runId: approval.runId,
          topic: approval.topic
        }
      });

      return notification;
    },

    handleReadyDelivery(delivery: PersistedDeliveryRecord): DispatchNotification {
      const notification = recordNotification({
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

      const deliveryRunId = (delivery as PersistedDeliveryRecord & { runId?: string }).runId;

      dashboardEmitter.emit("dashboard", {
        type: "delivery.state_changed",
        payload: {
          deliveryId: delivery.deliveryId,
          eventId: delivery.eventId,
          ...(deliveryRunId ? { runId: deliveryRunId } : {}),
          agentId: delivery.agentId,
          oldState: undefined,
          newState: delivery.status
        }
      });

      return notification;
    },

    snapshot(): DispatchNotification[] {
      return [...notifications];
    },

    dashboardEmitter
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
