import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import type { ApprovalStatus } from "./event-store.js";

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

export interface ClaimDeliveryInput {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly asOf?: string;
}

export interface DeliveryMutationOptions {
  readonly skipTransaction?: boolean;
}

export interface AcknowledgeDeliveryInput {
  readonly deliveryId: string;
  readonly leaseToken: string;
}

export interface FailDeliveryInput extends AcknowledgeDeliveryInput {
  readonly errorMessage: string;
  readonly retryDelayMs: number;
  readonly asOf?: string;
}

export interface DeadLetterDeliveryInput extends AcknowledgeDeliveryInput {
  readonly errorMessage: string;
  readonly asOf?: string;
}

export interface ReplayDeliveryInput {
  readonly deliveryId: string;
  readonly availableAt?: string;
}

export interface DeliveryWithEventRecord extends PersistedDeliveryRecord {
  readonly runId: string;
  readonly correlationId: string;
  readonly approvalStatus: ApprovalStatus;
  readonly eventOccurredAt: string;
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

interface DeliveryWithEventRow extends DeliveryRow {
  run_id: string;
  correlation_id: string;
  approval_status: ApprovalStatus;
  event_occurred_at: string;
}

const replayableDeliveryStatuses: readonly DeliveryStatus[] = [
  "completed",
  "dead_letter",
  "retry_scheduled",
  "ready"
];

function isReplayableDeliveryStatus(status: DeliveryStatus): boolean {
  return replayableDeliveryStatuses.includes(status);
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

function mapDeliveryWithEventRow(row: DeliveryWithEventRow): DeliveryWithEventRecord {
  return {
    ...mapDeliveryRow(row),
    runId: row.run_id,
    correlationId: row.correlation_id,
    approvalStatus: row.approval_status,
    eventOccurredAt: row.event_occurred_at
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
    WHERE status IN ('ready', 'retry_scheduled')
      AND available_at <= ?
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    ORDER BY available_at ASC, created_at ASC, delivery_id ASC
  `);
  const selectClaimableDelivery = database.prepare(`
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
    WHERE status IN ('ready', 'retry_scheduled')
      AND available_at <= ?
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    ORDER BY available_at ASC, created_at ASC, delivery_id ASC
    LIMIT 1
  `);
  const selectDeliveryById = database.prepare(`
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
    WHERE delivery_id = ?
  `);
  const selectDeliveriesForRun = database.prepare(`
    SELECT
      d.delivery_id,
      d.event_id,
      d.agent_id,
      d.topic,
      d.status,
      d.available_at,
      d.attempt_count,
      d.max_attempts,
      d.last_error,
      d.lease_token,
      d.lease_owner,
      d.lease_expires_at,
      d.claimed_at,
      d.completed_at,
      d.last_attempted_at,
      d.dead_lettered_at,
      d.dead_letter_reason,
      d.replay_count,
      d.replayed_from_delivery_id,
      d.created_at,
      d.updated_at,
      e.run_id,
      e.correlation_id,
      e.approval_status,
      e.occurred_at AS event_occurred_at
    FROM deliveries d
    INNER JOIN events e ON e.event_id = d.event_id
    WHERE e.run_id = ?
    ORDER BY d.created_at ASC, d.delivery_id ASC
  `);
  const selectFailureDeliveries = database.prepare(`
    SELECT
      d.delivery_id,
      d.event_id,
      d.agent_id,
      d.topic,
      d.status,
      d.available_at,
      d.attempt_count,
      d.max_attempts,
      d.last_error,
      d.lease_token,
      d.lease_owner,
      d.lease_expires_at,
      d.claimed_at,
      d.completed_at,
      d.last_attempted_at,
      d.dead_lettered_at,
      d.dead_letter_reason,
      d.replay_count,
      d.replayed_from_delivery_id,
      d.created_at,
      d.updated_at,
      e.run_id,
      e.correlation_id,
      e.approval_status,
      e.occurred_at AS event_occurred_at
    FROM deliveries d
    INNER JOIN events e ON e.event_id = d.event_id
    WHERE d.status IN ('retry_scheduled', 'dead_letter')
    ORDER BY
      CASE d.status
        WHEN 'dead_letter' THEN 0
        ELSE 1
      END,
      d.updated_at DESC,
      d.delivery_id ASC
  `);
  const claimDelivery = database.prepare(`
    UPDATE deliveries
    SET status = 'leased',
        lease_token = ?,
        lease_owner = ?,
        lease_expires_at = ?,
        claimed_at = ?,
        last_attempted_at = ?,
        attempt_count = attempt_count + 1,
        updated_at = ?
    WHERE delivery_id = ?
      AND status IN ('ready', 'retry_scheduled')
      AND available_at <= ?
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
  `);
  const acknowledgeDelivery = database.prepare(`
    UPDATE deliveries
    SET status = 'completed',
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        completed_at = ?,
        updated_at = ?,
        last_error = NULL,
        dead_lettered_at = NULL,
        dead_letter_reason = NULL
    WHERE delivery_id = ? AND status = 'leased' AND lease_token = ?
  `);
  const scheduleRetry = database.prepare(`
    UPDATE deliveries
    SET status = 'retry_scheduled',
        available_at = ?,
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?,
        last_error = ?,
        dead_lettered_at = NULL,
        dead_letter_reason = NULL
    WHERE delivery_id = ? AND status = 'leased' AND lease_token = ?
  `);
  const deadLetterDelivery = database.prepare(`
    UPDATE deliveries
    SET status = 'dead_letter',
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?,
        last_error = ?,
        dead_lettered_at = ?,
        dead_letter_reason = ?
    WHERE delivery_id = ? AND status = 'leased' AND lease_token = ?
  `);
  const selectExpiredLeases = database.prepare(`
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
    WHERE status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
    ORDER BY lease_expires_at ASC, delivery_id ASC
  `);
  const reclaimExpiredLease = database.prepare(`
    UPDATE deliveries
    SET status = 'ready',
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        available_at = ?,
        updated_at = ?
    WHERE delivery_id = ? AND status = 'leased'
  `);
  const deadLetterExpiredLease = database.prepare(`
    UPDATE deliveries
    SET status = 'dead_letter',
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?,
        dead_lettered_at = ?,
        dead_letter_reason = ?
    WHERE delivery_id = ? AND status = 'leased'
  `);
  const replayDelivery = database.prepare(`
    UPDATE deliveries
    SET status = 'ready',
        available_at = ?,
        attempt_count = 0,
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        claimed_at = NULL,
        completed_at = NULL,
        last_attempted_at = NULL,
        updated_at = ?,
        last_error = NULL,
        dead_lettered_at = NULL,
        dead_letter_reason = NULL,
        replay_count = replay_count + 1,
        replayed_from_delivery_id = COALESCE(replayed_from_delivery_id, delivery_id)
    WHERE delivery_id = ?
      AND status IN ('completed', 'dead_letter', 'retry_scheduled', 'ready')
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

      const duplicateAgentIds = new Set<string>();

      for (const agentId of input.agentIds) {
        if (duplicateAgentIds.has(agentId)) {
          throw new Error(
            `Duplicate delivery planning requested for event ${input.eventId} and agent ${agentId}.`
          );
        }

        duplicateAgentIds.add(agentId);
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

    getDelivery(deliveryId: string): PersistedDeliveryRecord | null {
      const row = selectDeliveryById.get(deliveryId) as DeliveryRow | undefined;

      return row ? mapDeliveryRow(row) : null;
    },

    listDeliveriesForRun(runId: string): DeliveryWithEventRecord[] {
      const rows = selectDeliveriesForRun.all(runId) as unknown as DeliveryWithEventRow[];

      return rows.map(mapDeliveryWithEventRow);
    },

    listFailureDeliveries(): DeliveryWithEventRecord[] {
      const rows = selectFailureDeliveries.all() as unknown as DeliveryWithEventRow[];

      return rows.map(mapDeliveryWithEventRow);
    },

    listReadyDeliveries(asOf = new Date().toISOString()): PersistedDeliveryRecord[] {
      const rows = selectReadyDeliveries.all(asOf, asOf) as unknown as DeliveryRow[];

      return rows.map(mapDeliveryRow);
    },

    claimNextDelivery(
      input: ClaimDeliveryInput,
      options: DeliveryMutationOptions = {}
    ): PersistedDeliveryRecord | null {
      const manageTransaction = options.skipTransaction !== true;
      const asOf = input.asOf ?? new Date().toISOString();
      const leaseExpiresAt = new Date(
        new Date(asOf).getTime() + input.leaseDurationMs
      ).toISOString();

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const claimableRow = selectClaimableDelivery.get(asOf, asOf) as DeliveryRow | undefined;

        if (!claimableRow) {
          if (manageTransaction) {
            database.exec("COMMIT");
          }

          return null;
        }

        const leaseToken = randomUUID();
        const result = claimDelivery.run(
          leaseToken,
          input.workerId,
          leaseExpiresAt,
          asOf,
          asOf,
          asOf,
          claimableRow.delivery_id,
          asOf,
          asOf
        ) as { changes?: number };

        if (!result.changes) {
          throw new Error(`Failed to claim delivery ${claimableRow.delivery_id}.`);
        }

        if (manageTransaction) {
          database.exec("COMMIT");
        }

        return this.getDelivery(claimableRow.delivery_id);
      } catch (error) {
        if (manageTransaction) {
          database.exec("ROLLBACK");
        }

        throw error;
      }
    },

    acknowledgeDelivery(
      input: AcknowledgeDeliveryInput,
      options: DeliveryMutationOptions = {}
    ): PersistedDeliveryRecord {
      const manageTransaction = options.skipTransaction !== true;

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const completedAt = new Date().toISOString();
        const result = acknowledgeDelivery.run(
          completedAt,
          completedAt,
          input.deliveryId,
          input.leaseToken
        ) as { changes?: number };

        if (!result.changes) {
          throw new Error(
            `Active leased delivery not found for ${input.deliveryId} with the provided lease token.`
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

      const delivery = this.getDelivery(input.deliveryId);

      if (!delivery) {
        throw new Error(`Failed to load delivery ${input.deliveryId} after acknowledgement.`);
      }

      return delivery;
    },

    failDelivery(
      input: FailDeliveryInput,
      options: DeliveryMutationOptions = {}
    ): PersistedDeliveryRecord {
      const manageTransaction = options.skipTransaction !== true;
      const asOf = input.asOf ?? new Date().toISOString();

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const currentDelivery = this.getDelivery(input.deliveryId);

        if (!currentDelivery) {
          throw new Error(`Delivery ${input.deliveryId} not found.`);
        }

        if (currentDelivery.status !== "leased" || currentDelivery.leaseToken !== input.leaseToken) {
          throw new Error(
            `Active leased delivery not found for ${input.deliveryId} with the provided lease token.`
          );
        }

        if (currentDelivery.attemptCount >= currentDelivery.maxAttempts) {
          const result = deadLetterDelivery.run(
            asOf,
            input.errorMessage,
            asOf,
            input.errorMessage,
            input.deliveryId,
            input.leaseToken
          ) as { changes?: number };

          if (!result.changes) {
            throw new Error(`Failed to dead-letter delivery ${input.deliveryId}.`);
          }
        } else {
          const retryAt = new Date(
            new Date(asOf).getTime() + input.retryDelayMs
          ).toISOString();
          const result = scheduleRetry.run(
            retryAt,
            asOf,
            input.errorMessage,
            input.deliveryId,
            input.leaseToken
          ) as { changes?: number };

          if (!result.changes) {
            throw new Error(`Failed to schedule retry for delivery ${input.deliveryId}.`);
          }
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

      const delivery = this.getDelivery(input.deliveryId);

      if (!delivery) {
        throw new Error(`Failed to load delivery ${input.deliveryId} after failure handling.`);
      }

      return delivery;
    },

    deadLetterDelivery(
      input: DeadLetterDeliveryInput,
      options: DeliveryMutationOptions = {}
    ): PersistedDeliveryRecord {
      const manageTransaction = options.skipTransaction !== true;
      const asOf = input.asOf ?? new Date().toISOString();

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const result = deadLetterDelivery.run(
          asOf,
          input.errorMessage,
          asOf,
          input.errorMessage,
          input.deliveryId,
          input.leaseToken
        ) as { changes?: number };

        if (!result.changes) {
          throw new Error(`Failed to dead-letter delivery ${input.deliveryId}.`);
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

      const delivery = this.getDelivery(input.deliveryId);

      if (!delivery) {
        throw new Error(`Failed to load delivery ${input.deliveryId} after dead-lettering.`);
      }

      return delivery;
    },

    reclaimExpiredLeases(
      asOf = new Date().toISOString(),
      options: DeliveryMutationOptions = {}
    ): PersistedDeliveryRecord[] {
      const manageTransaction = options.skipTransaction !== true;

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const expiredRows = selectExpiredLeases.all(asOf) as unknown as DeliveryRow[];
        const updatedAt = new Date().toISOString();
        const reclaimedIds: string[] = [];

        for (const row of expiredRows) {
          if (row.attempt_count >= row.max_attempts) {
            deadLetterExpiredLease.run(
              updatedAt,
              updatedAt,
              row.last_error ?? "Lease expired after exhausting attempts.",
              row.delivery_id
            );
          } else {
            reclaimExpiredLease.run(asOf, updatedAt, row.delivery_id);
          }

          reclaimedIds.push(row.delivery_id);
        }

        if (manageTransaction) {
          database.exec("COMMIT");
        }

        return reclaimedIds
          .map((deliveryId) => this.getDelivery(deliveryId))
          .filter((delivery): delivery is PersistedDeliveryRecord => delivery !== null);
      } catch (error) {
        if (manageTransaction) {
          database.exec("ROLLBACK");
        }

        throw error;
      }
    },

    replayDelivery(
      input: ReplayDeliveryInput,
      options: DeliveryMutationOptions = {}
    ): PersistedDeliveryRecord {
      const manageTransaction = options.skipTransaction !== true;
      const availableAt = input.availableAt ?? new Date().toISOString();

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const updatedAt = new Date().toISOString();
        const result = replayDelivery.run(
          availableAt,
          updatedAt,
          input.deliveryId
        ) as { changes?: number };

        if (!result.changes) {
          throw new Error(
            `Replay requires a terminal or retryable delivery state for ${input.deliveryId}.`
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

      const delivery = this.getDelivery(input.deliveryId);

      if (!delivery) {
        throw new Error(`Failed to load delivery ${input.deliveryId} after replay.`);
      }

      return delivery;
    },

    replayEventDeliveries(
      eventId: string,
      availableAt?: string,
      options: DeliveryMutationOptions = {}
    ): PersistedDeliveryRecord[] {
      const manageTransaction = options.skipTransaction !== true;

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const deliveries = this.listDeliveriesForEvent(eventId);
        const replayed: PersistedDeliveryRecord[] = [];

        for (const delivery of deliveries) {
          if (!isReplayableDeliveryStatus(delivery.status)) {
            continue;
          }

          replayed.push(
            this.replayDelivery(
              {
                deliveryId: delivery.deliveryId,
                ...(availableAt ? { availableAt } : {})
              },
              { skipTransaction: true }
            )
          );
        }

        if (manageTransaction) {
          database.exec("COMMIT");
        }

        return replayed;
      } catch (error) {
        if (manageTransaction) {
          database.exec("ROLLBACK");
        }

        throw error;
      }
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
