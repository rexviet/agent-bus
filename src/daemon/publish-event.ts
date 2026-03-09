import type { DatabaseSync } from "node:sqlite";

import type { AgentBusManifest } from "../config/manifest-schema.js";
import type { EventEnvelope } from "../domain/event-envelope.js";
import type {
  DeliveryStatus,
  PersistedDeliveryRecord
} from "../storage/delivery-store.js";
import type { PersistedEventRecord } from "../storage/event-store.js";
import type { Dispatcher } from "./dispatcher.js";
import type {
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";

function approvalRequiredForTopic(
  manifest: AgentBusManifest,
  topic: string
): boolean {
  return manifest.approvalGates.some((gate) => gate.topic === topic);
}

function subscribedAgentIdsForTopic(
  manifest: AgentBusManifest,
  topic: string
): string[] {
  const agentIds: string[] = [];
  const seenAgentIds = new Set<string>();

  for (const subscription of manifest.subscriptions) {
    if (subscription.topic !== topic || seenAgentIds.has(subscription.agentId)) {
      continue;
    }

    seenAgentIds.add(subscription.agentId);
    agentIds.push(subscription.agentId);
  }

  return agentIds;
}

export interface PublishEventOptions {
  readonly database: DatabaseSync;
  readonly manifest: AgentBusManifest;
  readonly runStore: ReturnTypeOfCreateRunStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly dispatcher: Dispatcher;
  readonly envelope: EventEnvelope;
}

export function publishEvent({
  database,
  manifest,
  runStore,
  eventStore,
  deliveryStore,
  dispatcher,
  envelope
}: PublishEventOptions) {
  if (!runStore.getRun(envelope.runId)) {
    runStore.createRun({
      runId: envelope.runId,
      status: "active",
      metadata: {
        startedBy: envelope.producer.agentId
      }
    });
  }

  const approvalStatus = approvalRequiredForTopic(manifest, envelope.topic)
    ? "pending"
    : "not_required";
  const approvalId =
    approvalStatus === "pending" ? `approval:${envelope.eventId}` : undefined;
  const deliveryStatus: DeliveryStatus =
    approvalStatus === "pending" ? "pending_approval" : "ready";
  const agentIds = subscribedAgentIdsForTopic(manifest, envelope.topic);

  database.exec("BEGIN");

  let persistedEvent: PersistedEventRecord;
  let plannedDeliveries: PersistedDeliveryRecord[];

  try {
    persistedEvent = eventStore.insertEvent(
      {
        envelope,
        approvalStatus,
        ...(approvalId ? { approvalId } : {})
      },
      { skipTransaction: true }
    );
    plannedDeliveries = deliveryStore.planDeliveries(
      {
        eventId: envelope.eventId,
        topic: envelope.topic,
        agentIds,
        status: deliveryStatus,
        availableAt: persistedEvent.createdAt
      },
      { skipTransaction: true }
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  if (approvalStatus === "pending") {
    dispatcher.handlePendingApproval({
      approvalId: approvalId as string,
      eventId: persistedEvent.eventId,
      topic: persistedEvent.topic,
      status: "pending",
      requestedAt: persistedEvent.createdAt
    });
  } else {
    for (const delivery of plannedDeliveries) {
      dispatcher.handleReadyDelivery(delivery);
    }
  }

  return persistedEvent;
}
