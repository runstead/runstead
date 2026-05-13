import {
  ApprovalRequestSchema,
  createRunsteadId,
  type ApprovalRequest,
  type JsonObject,
  type PolicyDecisionRecord,
  type RunsteadEvent,
  type Task,
  TaskSchema
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

export interface FindApprovedApprovalOptions {
  database: ReturnType<typeof openRunsteadDatabase>;
  actionId: string;
  now?: Date;
}

export interface ExpireApprovalGrantOptions {
  database: ReturnType<typeof openRunsteadDatabase>;
  approval: ApprovalRequest;
  now?: Date;
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
    updateTaskForApprovalDecision(database, approval);
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

export function findApprovedApprovalForAction(
  options: FindApprovedApprovalOptions
): ApprovalRequest | undefined {
  const row = options.database
    .prepare(
      `
      SELECT id, policy_decision_id, action_id, status, risk, reason,
             requested_by, expires_at, decided_at, decided_by,
             created_at, updated_at
      FROM approvals
      WHERE action_id = ? AND status = 'approved'
      ORDER BY decided_at ASC, created_at ASC, id ASC
      LIMIT 1
    `
    )
    .get(options.actionId) as ApprovalRow | undefined;

  if (row === undefined) {
    return undefined;
  }

  const approval = rowToApproval(row);
  const now = options.now ?? new Date();

  if (approval.expiresAt !== undefined && Date.parse(approval.expiresAt) <= now.getTime()) {
    return undefined;
  }

  return approval;
}

export function expireApprovalGrant(
  options: ExpireApprovalGrantOptions
): ApprovalRequest {
  const expiredAt = (options.now ?? new Date()).toISOString();
  const approval: ApprovalRequest = {
    ...options.approval,
    status: "expired",
    updatedAt: expiredAt
  };

  appendEventAndProject(options.database, {
    event: approvalEvent(
      "approval.expired",
      approval,
      approvalPayload(approval),
      expiredAt
    ),
    projection: {
      type: "approval",
      value: approval
    }
  });

  return approval;
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

function updateTaskForApprovalDecision(
  database: ReturnType<typeof openRunsteadDatabase>,
  approval: ApprovalRequest
): void {
  const task = taskForApproval(database, approval);

  if (task === undefined || task.status !== "waiting_approval") {
    return;
  }

  const updatedTask: Task = {
    ...task,
    status: approval.status === "approved" ? "queued" : "blocked",
    output: {
      ...(task.output ?? {}),
      approval: {
        id: approval.id,
        status: approval.status,
        decidedAt: approval.decidedAt,
        decidedBy: approval.decidedBy
      }
    },
    updatedAt: approval.updatedAt
  };

  appendEventAndProject(database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: approval.status === "approved" ? "task.requeued" : "task.blocked",
      aggregateType: "task",
      aggregateId: updatedTask.id,
      payload: {
        approvalId: approval.id,
        approvalStatus: approval.status,
        previousStatus: task.status
      },
      createdAt: approval.updatedAt
    },
    projection: {
      type: "task",
      value: updatedTask
    }
  });
}

function taskForApproval(
  database: ReturnType<typeof openRunsteadDatabase>,
  approval: ApprovalRequest
): Task | undefined {
  const row = database
    .prepare(
      `
      SELECT t.id, t.goal_id, t.domain, t.type, t.status, t.priority, t.attempt,
             t.max_attempts, t.input_json, t.output_json, t.verifiers_json,
             t.created_at, t.updated_at
      FROM tool_calls tc
      JOIN tasks t ON t.id = tc.task_id
      WHERE tc.policy_decision_id = ?
      ORDER BY tc.started_at DESC, tc.id ASC
      LIMIT 1
    `
    )
    .get(approval.policyDecisionId) as TaskRow | undefined;

  return row === undefined ? undefined : rowToTask(row);
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

interface TaskRow {
  id: string;
  goal_id: string;
  domain: string;
  type: string;
  status: string;
  priority: string;
  attempt: number;
  max_attempts: number;
  input_json: string;
  output_json: string | null;
  verifiers_json: string;
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

function rowToTask(row: TaskRow): Task {
  return TaskSchema.parse({
    id: row.id,
    goalId: row.goal_id,
    domain: row.domain,
    type: row.type,
    status: row.status,
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    input: JSON.parse(row.input_json) as JsonObject,
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as JsonObject }),
    verifiers: JSON.parse(row.verifiers_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
