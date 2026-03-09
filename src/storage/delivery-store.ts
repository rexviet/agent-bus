import type { DatabaseSync } from "node:sqlite";

export type DeliveryStatus =
  | "pending_approval"
  | "ready"
  | "leased"
  | "retry_scheduled"
  | "completed"
  | "dead_letter"
  | "cancelled";

export interface PersistedDeliveryRecord {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly agentId: string;
  readonly topic: string;
  readonly status: DeliveryStatus;
  readonly availableAt: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly lastError?: string;
  readonly leaseToken?: string;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly claimedAt?: string;
  readonly completedAt?: string;
  readonly lastAttemptedAt?: string;
  readonly deadLetteredAt?: string;
  readonly deadLetterReason?: string;
  readonly replayCount: number;
  readonly replayedFromDeliveryId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlanDeliveriesInput {
  readonly eventId: string;
  readonly topic: string;
  readonly agentIds: readonly string[];
  readonly status: DeliveryStatus;
  readonly availableAt?: string;
  readonly maxAttempts?: number;
}

export interface PlanDeliveriesOptions {
  readonly skipTransaction?: boolean;
}

interface DeliveryRow {
  delivery_id: string;
  event_id: string;
  agent_id: string;
  topic: string;
  status: DeliveryStatus;
  available_at: string;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  lease_token: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  last_attempted_at: string | null;
  dead_lettered_at: string | null;
  dead_letter_reason: string | null;
  replay_count: number;
  replayed_from_delivery_id: string | null;
  created_at: string;
  updated_at: string;
}

function createDeliveryId(eventId: string, agentId: string): string {
  return `delivery:${eventId}:${agentId}`;
}

function mapDeliveryRow(row: DeliveryRow): PersistedDeliveryRecord {
  const deliveryBase = {
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    agentId: row.agent_id,
    topic: row.topic,
    status: row.status,
    availableAt: row.available_at,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    replayCount: row.replay_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  return {
    ...deliveryBase,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.last_attempted_at ? { lastAttemptedAt: row.last_attempted_at } : {}),
    ...(row.dead_lettered_at ? { deadLetteredAt: row.dead_lettered_at } : {}),
    ...(row.dead_letter_reason ? { deadLetterReason: row.dead_letter_reason } : {}),
    ...(row.replayed_from_delivery_id
      ? { replayedFromDeliveryId: row.replayed_from_delivery_id }
      : {})
  };
}

export function createDeliveryStore(database: DatabaseSync) {
  const insertDelivery = database.prepare(`
    INSERT INTO deliveries (
      delivery_id,
      event_id,
      agent_id,
      topic,
      status,
      available_at,
      attempt_count,
      max_attempts,
      lease_token,
      lease_owner,
      lease_expires_at,
      claimed_at,
      completed_at,
      last_attempted_at,
      last_error,
      dead_lettered_at,
      dead_letter_reason,
      replay_count,
      replayed_from_delivery_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, ?)
  `);
  const selectDeliveriesByEvent = database.prepare(`
    SELECT
      delivery_id,
      event_id,
      agent_id,
      topic,
      status,
      available_at,
      attempt_count,
      max_attempts,
      lease_token,
      lease_owner,
      lease_expires_at,
      claimed_at,
      completed_at,
      last_attempted_at,
      last_error,
      dead_lettered_at,
      dead_letter_reason,
      replay_count,
      replayed_from_delivery_id,
      created_at,
      updated_at
    FROM deliveries
    WHERE event_id = ?
    ORDER BY created_at ASC, agent_id ASC
  `);
  const selectReadyDeliveries = database.prepare(`
    SELECT
      delivery_id,
      event_id,
      agent_id,
      topic,
      status,
      available_at,
      attempt_count,
      max_attempts,
      lease_token,
      lease_owner,
      lease_expires_at,
      claimed_at,
      completed_at,
      last_attempted_at,
      last_error,
      dead_lettered_at,
      dead_letter_reason,
      replay_count,
      replayed_from_delivery_id,
      created_at,
      updated_at
    FROM deliveries
    WHERE status = 'ready' AND available_at <= ?
    ORDER BY available_at ASC, created_at ASC, delivery_id ASC
  `);
  const updateStatusForEvent = database.prepare(`
    UPDATE deliveries
    SET status = ?,
        updated_at = ?,
        available_at = CASE
          WHEN ? IS NULL THEN available_at
          ELSE ?
        END
    WHERE event_id = ? AND status = ?
  `);

  return {
    planDeliveries(
      input: PlanDeliveriesInput,
      options: PlanDeliveriesOptions = {}
    ): PersistedDeliveryRecord[] {
      if (input.agentIds.length === 0) {
        return [];
      }

      const createdAt = new Date().toISOString();
      const availableAt = input.availableAt ?? createdAt;
      const maxAttempts = input.maxAttempts ?? 3;
      const manageTransaction = options.skipTransaction !== true;

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        for (const agentId of input.agentIds) {
          insertDelivery.run(
            createDeliveryId(input.eventId, agentId),
            input.eventId,
            agentId,
            input.topic,
            input.status,
            availableAt,
            maxAttempts,
            createdAt,
            createdAt
          );
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

      return this.listDeliveriesForEvent(input.eventId);
    },

    listDeliveriesForEvent(eventId: string): PersistedDeliveryRecord[] {
      const rows = selectDeliveriesByEvent.all(eventId) as unknown as DeliveryRow[];

      return rows.map(mapDeliveryRow);
    },

    listReadyDeliveries(asOf = new Date().toISOString()): PersistedDeliveryRecord[] {
      const rows = selectReadyDeliveries.all(asOf) as unknown as DeliveryRow[];

      return rows.map(mapDeliveryRow);
    },

    transitionEventDeliveries(
      eventId: string,
      fromStatus: DeliveryStatus,
      toStatus: DeliveryStatus,
      availableAt?: string,
      options: PlanDeliveriesOptions = {}
    ): PersistedDeliveryRecord[] {
      const manageTransaction = options.skipTransaction !== true;

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const updatedAt = new Date().toISOString();

        updateStatusForEvent.run(
          toStatus,
          updatedAt,
          availableAt ?? null,
          availableAt ?? null,
          eventId,
          fromStatus
        );

        if (manageTransaction) {
          database.exec("COMMIT");
        }
      } catch (error) {
        if (manageTransaction) {
          database.exec("ROLLBACK");
        }

        throw error;
      }

      return this.listDeliveriesForEvent(eventId);
    }
  };
}
