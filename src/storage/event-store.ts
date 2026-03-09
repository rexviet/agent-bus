import type { DatabaseSync } from "node:sqlite";

import type { EventEnvelope } from "../domain/event-envelope.js";

export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";

export interface PendingApprovalRecord {
  readonly approvalId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly status: string;
  readonly requestedAt: string;
}

export interface PersistedEventRecord {
  readonly eventId: string;
  readonly runId: string;
  readonly topic: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly dedupeKey: string;
  readonly approvalStatus: ApprovalStatus;
  readonly producer: EventEnvelope["producer"];
  readonly payload: Record<string, unknown>;
  readonly payloadMetadata: Record<string, unknown>;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly artifactRefs: EventEnvelope["artifactRefs"];
}

export interface InsertEventInput {
  readonly envelope: EventEnvelope;
  readonly approvalStatus?: ApprovalStatus;
  readonly approvalId?: string;
}

interface EventRow {
  event_id: string;
  run_id: string;
  topic: string;
  correlation_id: string;
  causation_id: string | null;
  dedupe_key: string;
  approval_status: ApprovalStatus;
  producer_agent_id: string;
  producer_runtime: string;
  producer_model: string | null;
  payload_json: string;
  payload_metadata_json: string;
  occurred_at: string;
  created_at: string;
}

interface EventArtifactRow {
  path: string;
  role: string | null;
  description: string | null;
  media_type: string | null;
}

interface ApprovalRow {
  approval_id: string;
  event_id: string;
  topic: string;
  status: string;
  requested_at: string;
}

function mapPersistedEvent(
  eventRow: EventRow,
  artifactRows: EventArtifactRow[]
): PersistedEventRecord {
  const producer: PersistedEventRecord["producer"] = {
    agentId: eventRow.producer_agent_id,
    runtime: eventRow.producer_runtime
  };

  if (eventRow.producer_model) {
    producer.model = eventRow.producer_model;
  }

  const artifactRefs: PersistedEventRecord["artifactRefs"] = artifactRows.map((artifactRow) => {
    const artifactRef: PersistedEventRecord["artifactRefs"][number] = {
      path: artifactRow.path
    };

    if (artifactRow.role) {
      artifactRef.role = artifactRow.role;
    }

    if (artifactRow.description) {
      artifactRef.description = artifactRow.description;
    }

    if (artifactRow.media_type) {
      artifactRef.mediaType = artifactRow.media_type;
    }

    return artifactRef;
  });

  const persistedEventBase = {
    eventId: eventRow.event_id,
    runId: eventRow.run_id,
    topic: eventRow.topic,
    correlationId: eventRow.correlation_id,
    dedupeKey: eventRow.dedupe_key,
    approvalStatus: eventRow.approval_status,
    producer,
    payload: JSON.parse(eventRow.payload_json) as Record<string, unknown>,
    payloadMetadata: JSON.parse(eventRow.payload_metadata_json) as Record<string, unknown>,
    occurredAt: eventRow.occurred_at,
    createdAt: eventRow.created_at,
    artifactRefs
  };

  return eventRow.causation_id
    ? {
        ...persistedEventBase,
        causationId: eventRow.causation_id
      }
    : persistedEventBase;
}

export function createEventStore(database: DatabaseSync) {
  const insertEvent = database.prepare(`
    INSERT INTO events (
      event_id,
      run_id,
      topic,
      correlation_id,
      causation_id,
      dedupe_key,
      approval_status,
      producer_agent_id,
      producer_runtime,
      producer_model,
      payload_json,
      payload_metadata_json,
      occurred_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertArtifact = database.prepare(`
    INSERT INTO event_artifacts (event_id, path, role, description, media_type)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertApproval = database.prepare(`
    INSERT INTO approvals (approval_id, event_id, topic, status, requested_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const selectEvent = database.prepare(`
    SELECT
      event_id,
      run_id,
      topic,
      correlation_id,
      causation_id,
      dedupe_key,
      approval_status,
      producer_agent_id,
      producer_runtime,
      producer_model,
      payload_json,
      payload_metadata_json,
      occurred_at,
      created_at
    FROM events
    WHERE event_id = ?
  `);
  const selectArtifacts = database.prepare(`
    SELECT path, role, description, media_type
    FROM event_artifacts
    WHERE event_id = ?
    ORDER BY path ASC
  `);
  const selectPendingApprovals = database.prepare(`
    SELECT approval_id, event_id, topic, status, requested_at
    FROM approvals
    WHERE status = 'pending'
    ORDER BY requested_at ASC
  `);

  return {
    insertEvent(input: InsertEventInput): PersistedEventRecord {
      const approvalStatus = input.approvalStatus ?? "not_required";
      const createdAt = new Date().toISOString();

      database.exec("BEGIN");

      try {
        insertEvent.run(
          input.envelope.eventId,
          input.envelope.runId,
          input.envelope.topic,
          input.envelope.correlationId,
          input.envelope.causationId ?? null,
          input.envelope.dedupeKey,
          approvalStatus,
          input.envelope.producer.agentId,
          input.envelope.producer.runtime,
          input.envelope.producer.model ?? null,
          JSON.stringify(input.envelope.payload),
          JSON.stringify(input.envelope.payloadMetadata),
          input.envelope.occurredAt,
          createdAt
        );

        for (const artifactRef of input.envelope.artifactRefs) {
          insertArtifact.run(
            input.envelope.eventId,
            artifactRef.path,
            artifactRef.role ?? null,
            artifactRef.description ?? null,
            artifactRef.mediaType ?? null
          );
        }

        if (approvalStatus === "pending") {
          insertApproval.run(
            input.approvalId ?? `approval:${input.envelope.eventId}`,
            input.envelope.eventId,
            input.envelope.topic,
            "pending",
            createdAt
          );
        }

        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      const persisted = this.getEvent(input.envelope.eventId);

      if (!persisted) {
        throw new Error(`Failed to fetch persisted event ${input.envelope.eventId}.`);
      }

      return persisted;
    },

    getEvent(eventId: string): PersistedEventRecord | null {
      const eventRow = selectEvent.get(eventId) as EventRow | undefined;

      if (!eventRow) {
        return null;
      }

      const artifactRows = selectArtifacts.all(eventId) as unknown as EventArtifactRow[];

      return mapPersistedEvent(eventRow, artifactRows);
    },

    listPendingApprovals(): PendingApprovalRecord[] {
      const approvalRows = selectPendingApprovals.all() as unknown as ApprovalRow[];

      return approvalRows.map((row) => ({
        approvalId: row.approval_id,
        eventId: row.event_id,
        topic: row.topic,
        status: row.status,
        requestedAt: row.requested_at
      }));
    }
  };
}
