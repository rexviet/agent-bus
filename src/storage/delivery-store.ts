import type { DatabaseSync } from "node:sqlite";

export type DeliveryStatus = "pending_approval" | "ready";

export interface PersistedDeliveryRecord {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly agentId: string;
  readonly topic: string;
  readonly status: DeliveryStatus;
  readonly availableAt: string;
  readonly attemptCount: number;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlanDeliveriesInput {
  readonly eventId: string;
  readonly topic: string;
  readonly agentIds: readonly string[];
  readonly status: DeliveryStatus;
  readonly availableAt?: string;
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
  last_error: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  return row.last_error
    ? {
        ...deliveryBase,
        lastError: row.last_error
      }
    : deliveryBase;
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
      last_error,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
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
      last_error,
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
      last_error,
      created_at,
      updated_at
    FROM deliveries
    WHERE status = 'ready' AND available_at <= ?
    ORDER BY available_at ASC, created_at ASC, delivery_id ASC
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
    }
  };
}
