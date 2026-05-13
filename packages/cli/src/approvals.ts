import {
  ApprovalRequestSchema,
  createRunsteadId,
  type ApprovalRequest,
  type JsonObject,
  type PolicyDecisionRecord,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDbSync } from "./runstead-root.js";

export interface RequestApprovalOptions {
  database: ReturnType<typeof openRunsteadDatabase>;
  policyDecision: PolicyDecisionRecord;
  requestedBy?: string;
  expiresAt?: string;
  now?: Date;
}

export interface ListApprovalsOptions {
  cwd?: string;
  status?: ApprovalRequest["status"];
}

export interface ListApprovalsResult {
  approvals: ApprovalRequest[];
  stateDb: string;
}

export interface ShowApprovalOptions {
  cwd?: string;
  id: string;
}

export interface ShowApprovalResult {
  approval: ApprovalRequest;
  stateDb: string;
}

export interface DecideApprovalOptions extends ShowApprovalOptions {
  decision: "approved" | "denied";
  decidedBy?: string;
  now?: Date;
}

export interface DecideApprovalResult {
  approval: ApprovalRequest;
  event: RunsteadEvent;
  previousStatus: ApprovalRequest["status"];
  stateDb: string;
}

export function requestApproval(options: RequestApprovalOptions): ApprovalRequest {
  const createdAt = (options.now ?? new Date()).toISOString();
  const approval = ApprovalRequestSchema.parse({
    id: createRunsteadId("appr"),
    policyDecisionId: options.policyDecision.id,
    actionId: options.policyDecision.actionId,
    status: "pending",
    risk: options.policyDecision.risk,
    reason: options.policyDecision.reason,
    requestedBy: options.requestedBy ?? "runstead",
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
    createdAt,
    updatedAt: createdAt
  });

  appendEventAndProject(options.database, {
    event: approvalEvent("approval.requested", approval, approvalPayload(approval), createdAt),
    projection: {
      type: "approval",
      value: approval
    }
  });

  return approval;
}

export function listApprovals(
  options: ListApprovalsOptions = {}
): ListApprovalsResult {
  const stateDb = requireRunsteadStateDbSync(options.cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows =
      options.status === undefined
        ? (database
            .prepare(
              `
              SELECT id, policy_decision_id, action_id, status, risk, reason,
                     requested_by, expires_at, decided_at, decided_by,
                     created_at, updated_at
              FROM approvals
              ORDER BY created_at DESC, id ASC
            `
            )
            .all() as unknown as ApprovalRow[])
        : (database
            .prepare(
              `
              SELECT id, policy_decision_id, action_id, status, risk, reason,
                     requested_by, expires_at, decided_at, decided_by,
                     created_at, updated_at
              FROM approvals
              WHERE status = ?
              ORDER BY created_at DESC, id ASC
            `
            )
            .all(options.status) as unknown as ApprovalRow[]);

    return {
      approvals: rows.map(rowToApproval),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function showApproval(options: ShowApprovalOptions): ShowApprovalResult {
  const stateDb = requireRunsteadStateDbSync(options.cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare(
        `
        SELECT id, policy_decision_id, action_id, status, risk, reason,
               requested_by, expires_at, decided_at, decided_by,
               created_at, updated_at
        FROM approvals
        WHERE id = ?
      `
      )
      .get(options.id) as ApprovalRow | undefined;

    if (row === undefined) {
      throw new Error(`Approval not found: ${options.id}`);
    }

    return {
      approval: rowToApproval(row),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function decideApproval(options: DecideApprovalOptions): DecideApprovalResult {
  const current = showApproval(options);

  if (current.approval.status !== "pending") {
    throw new Error(
      `Approval ${options.id} is ${current.approval.status}, expected pending`
    );
  }

  const decidedAt = (options.now ?? new Date()).toISOString();
  const approval: ApprovalRequest = {
    ...current.approval,
    status: options.decision,
    decidedAt,
    decidedBy: options.decidedBy ?? "runstead",
    updatedAt: decidedAt
  };
  const event = approvalEvent(
    options.decision === "approved" ? "approval.approved" : "approval.denied",
    approval,
    approvalPayload(approval),
    decidedAt
  );
  const database = openRunsteadDatabase(current.stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "approval",
        value: approval
      }
    });
  } finally {
    database.close();
  }

  return {
    approval,
    event,
    previousStatus: current.approval.status,
    stateDb: current.stateDb
  };
}

function approvalEvent(
  type: string,
  approval: ApprovalRequest,
  payload: JsonObject,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType: "approval",
    aggregateId: approval.id,
    payload,
    createdAt
  };
}

function approvalPayload(approval: ApprovalRequest): JsonObject {
  return {
    approvalId: approval.id,
    policyDecisionId: approval.policyDecisionId,
    actionId: approval.actionId,
    status: approval.status,
    risk: approval.risk,
    reason: approval.reason,
    ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
    ...(approval.decidedBy === undefined ? {} : { decidedBy: approval.decidedBy })
  };
}

interface ApprovalRow {
  id: string;
  policy_decision_id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  requested_by: string | null;
  expires_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToApproval(row: ApprovalRow): ApprovalRequest {
  return ApprovalRequestSchema.parse({
    id: row.id,
    policyDecisionId: row.policy_decision_id,
    actionId: row.action_id,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    ...(row.requested_by === null ? {} : { requestedBy: row.requested_by }),
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
    ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
