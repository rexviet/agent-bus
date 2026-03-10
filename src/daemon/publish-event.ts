import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { EmittedEventDraft } from "../adapters/contract.js";
import type { AgentBusManifest } from "../config/manifest-schema.js";
import type { EventEnvelope } from "../domain/event-envelope.js";
import type {
  DeliveryStatus,
  PersistedDeliveryRecord
} from "../storage/delivery-store.js";
import type {
  PendingApprovalRecord,
  PersistedEventRecord
} from "../storage/event-store.js";
import type { Dispatcher } from "./dispatcher.js";
import { planSubscriptionsForTopic } from "./subscription-planner.js";
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

function buildPendingApprovalRecord(
  approvalId: string,
  event: PersistedEventRecord
): PendingApprovalRecord {
  return {
    approvalId,
    eventId: event.eventId,
    topic: event.topic,
    status: "pending",
    requestedAt: event.createdAt
  };
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

export interface PersistPublishedEventOptions {
  readonly database: DatabaseSync;
  readonly manifest: AgentBusManifest;
  readonly runStore: ReturnTypeOfCreateRunStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly envelope: EventEnvelope;
}

export interface PersistPublishedEventMutationOptions {
  readonly skipTransaction?: boolean;
}

export interface PersistPublishedEventResult {
  readonly event: PersistedEventRecord;
  readonly plannedDeliveries: PersistedDeliveryRecord[];
  readonly pendingApproval?: PendingApprovalRecord;
}

export interface BuildFollowUpEventEnvelopeInput {
  readonly draft: EmittedEventDraft;
  readonly sourceEvent: PersistedEventRecord;
  readonly producer: {
    readonly agentId: string;
    readonly runtime: string;
    readonly model?: string;
  };
  readonly sequence: number;
  readonly defaultArtifactRefs?: EventEnvelope["artifactRefs"];
  readonly occurredAt?: string;
}

export function buildFollowUpEventEnvelope(
  input: BuildFollowUpEventEnvelopeInput
): EventEnvelope {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const artifactRefs =
    input.draft.artifactRefs.length > 0
      ? input.draft.artifactRefs
      : (input.defaultArtifactRefs ?? []);

  return {
    eventId: randomUUID(),
    topic: input.draft.topic,
    runId: input.sourceEvent.runId,
    correlationId: input.sourceEvent.correlationId,
    causationId: input.sourceEvent.eventId,
    dedupeKey:
      input.draft.dedupeKey ??
      `${input.draft.topic}:${input.sourceEvent.eventId}:${input.producer.agentId}:${input.sequence}`,
    occurredAt,
    producer: input.producer,
    payload: input.draft.payload,
    payloadMetadata: input.draft.payloadMetadata,
    artifactRefs
  };
}

export function persistPublishedEvent({
  database,
  manifest,
  runStore,
  eventStore,
  deliveryStore,
  envelope
}: PersistPublishedEventOptions,
options: PersistPublishedEventMutationOptions = {}
): PersistPublishedEventResult {
  const runAlreadyExists = runStore.getRun(envelope.runId) !== null;

  if (!runAlreadyExists) {
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
  const plannedTargets = planSubscriptionsForTopic(manifest, envelope.topic);
  const manageTransaction = options.skipTransaction !== true;

  if (manageTransaction) {
    database.exec("BEGIN");
  }

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
        agentIds: plannedTargets.map((target) => target.agentId),
        status: deliveryStatus,
        availableAt: persistedEvent.createdAt
      },
      { skipTransaction: true }
    );
    if (runAlreadyExists) {
      runStore.touchRun(envelope.runId);
    }
    if (manageTransaction) {
      database.exec("COMMIT");
    }
  } catch (error) {
    if (manageTransaction) {
      database.exec("ROLLBACK");
    }

    throw error;
  }

  return {
    event: persistedEvent,
    plannedDeliveries,
    ...(approvalId
      ? { pendingApproval: buildPendingApprovalRecord(approvalId, persistedEvent) }
      : {})
  };
}

export function dispatchPublishedEvent(
  dispatcher: Dispatcher,
  result: PersistPublishedEventResult
): void {
  if (result.pendingApproval) {
    dispatcher.handlePendingApproval(result.pendingApproval);
    return;
  }

  for (const delivery of result.plannedDeliveries) {
    dispatcher.handleReadyDelivery(delivery);
  }
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
  const result = persistPublishedEvent({
    database,
    manifest,
    runStore,
    eventStore,
    deliveryStore,
    envelope
  });

  dispatchPublishedEvent(dispatcher, result);

  return result.event;
}
