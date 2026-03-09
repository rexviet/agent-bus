import type { AgentBusManifest } from "../config/manifest-schema.js";
import type { EventEnvelope } from "../domain/event-envelope.js";
import type { Dispatcher } from "./dispatcher.js";
import type {
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";

function approvalRequiredForTopic(
  manifest: AgentBusManifest,
  topic: string
): boolean {
  return manifest.approvalGates.some((gate) => gate.topic === topic);
}

export interface PublishEventOptions {
  readonly manifest: AgentBusManifest;
  readonly runStore: ReturnTypeOfCreateRunStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly dispatcher: Dispatcher;
  readonly envelope: EventEnvelope;
}

export function publishEvent({
  manifest,
  runStore,
  eventStore,
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
  const persistedEvent = eventStore.insertEvent({
    envelope,
    approvalStatus
  });

  dispatcher.handlePersistedEvent(persistedEvent);

  return persistedEvent;
}
