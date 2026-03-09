import type { DatabaseSync } from "node:sqlite";

export type ApprovalDecisionStatus = "pending" | "approved" | "rejected";

export interface ApprovalRecord {
  readonly approvalId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly status: ApprovalDecisionStatus;
  readonly requestedAt: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly feedback?: string;
}

export interface RecordApprovalDecisionInput {
  readonly approvalId: string;
  readonly decidedBy: string;
  readonly feedback?: string;
}

export interface ApprovalStoreOptions {
  readonly skipTransaction?: boolean;
}

interface ApprovalRow {
  approval_id: string;
  event_id: string;
  topic: string;
  status: ApprovalDecisionStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  feedback: string | null;
}

function mapApprovalRow(row: ApprovalRow): ApprovalRecord {
  const approvalBase = {
    approvalId: row.approval_id,
    eventId: row.event_id,
    topic: row.topic,
    status: row.status,
    requestedAt: row.requested_at
  };

  return {
    ...approvalBase,
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
    ...(row.feedback ? { feedback: row.feedback } : {})
  };
}

export function createApprovalStore(database: DatabaseSync) {
  const selectPendingApprovals = database.prepare(`
    SELECT
      approval_id,
      event_id,
      topic,
      status,
      requested_at,
      decided_at,
      decided_by,
      feedback
    FROM approvals
    WHERE status = 'pending'
    ORDER BY requested_at ASC
  `);
  const selectApprovalById = database.prepare(`
    SELECT
      approval_id,
      event_id,
      topic,
      status,
      requested_at,
      decided_at,
      decided_by,
      feedback
    FROM approvals
    WHERE approval_id = ?
  `);
  const selectApprovalByEventId = database.prepare(`
    SELECT
      approval_id,
      event_id,
      topic,
      status,
      requested_at,
      decided_at,
      decided_by,
      feedback
    FROM approvals
    WHERE event_id = ?
  `);
  const approveStatement = database.prepare(`
    UPDATE approvals
    SET status = 'approved',
        decided_at = ?,
        decided_by = ?,
        feedback = NULL
    WHERE approval_id = ? AND status = 'pending'
  `);
  const rejectStatement = database.prepare(`
    UPDATE approvals
    SET status = 'rejected',
        decided_at = ?,
        decided_by = ?,
        feedback = ?
    WHERE approval_id = ? AND status = 'pending'
  `);

  return {
    getApproval(approvalId: string): ApprovalRecord | null {
      const row = selectApprovalById.get(approvalId) as ApprovalRow | undefined;

      return row ? mapApprovalRow(row) : null;
    },

    getApprovalForEvent(eventId: string): ApprovalRecord | null {
      const row = selectApprovalByEventId.get(eventId) as ApprovalRow | undefined;

      return row ? mapApprovalRow(row) : null;
    },

    listPendingApprovals(): ApprovalRecord[] {
      const rows = selectPendingApprovals.all() as unknown as ApprovalRow[];

      return rows.map(mapApprovalRow);
    },

    approve(
      input: RecordApprovalDecisionInput,
      options: ApprovalStoreOptions = {}
    ): ApprovalRecord {
      const manageTransaction = options.skipTransaction !== true;

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const decidedAt = new Date().toISOString();
        const result = approveStatement.run(decidedAt, input.decidedBy, input.approvalId) as {
          changes?: number;
        };

        if (!result.changes) {
          throw new Error(`Pending approval not found for ${input.approvalId}.`);
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

      const approval = this.getApproval(input.approvalId);

      if (!approval) {
        throw new Error(`Failed to load approval ${input.approvalId} after approval.`);
      }

      return approval;
    },

    reject(
      input: RecordApprovalDecisionInput,
      options: ApprovalStoreOptions = {}
    ): ApprovalRecord {
      const manageTransaction = options.skipTransaction !== true;

      if (manageTransaction) {
        database.exec("BEGIN");
      }

      try {
        const decidedAt = new Date().toISOString();
        const result = rejectStatement.run(
          decidedAt,
          input.decidedBy,
          input.feedback ?? null,
          input.approvalId
        ) as {
          changes?: number;
        };

        if (!result.changes) {
          throw new Error(`Pending approval not found for ${input.approvalId}.`);
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

      const approval = this.getApproval(input.approvalId);

      if (!approval) {
        throw new Error(`Failed to load approval ${input.approvalId} after rejection.`);
      }

      return approval;
    }
  };
}
