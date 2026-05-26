import {
  createRunsteadId,
  type ApprovalRequest,
  type PolicyDecisionRecord,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import {
  appendEventAndProject,
  appendEventsAndProjectsInTransaction,
  openRunsteadDatabase,
  runStateTransaction,
  type AppendEventAndProjectInput
} from "@runstead/state-sqlite";

import { checkPermission } from "./rbac.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import {
  findPolicyDecision,
  readPendingApprovalForDecision,
  rowToApproval,
  taskForApproval,
  type ApprovalRow
} from "./approval-rows.js";
import {
  createApprovalDecisionTransition,
  createApprovalRequestTransition
} from "./approval-transitions.js";
export {
  approvalActionMetadata,
  type ApprovalActionMetadata
} from "./approval-action-metadata.js";
export {
  createApprovalExpirationTransition,
  createApprovalRequestTransition,
  DEFAULT_APPROVAL_TTL_MS,
  type ApprovalTransition
} from "./approval-transitions.js";
export {
  expireApprovalGrant,
  findApprovedApprovalForAction,
  findApprovedApprovalGrantForAction,
  type ApprovalGrantMatchKind,
  type ApprovedApprovalGrant,
  type ExpireApprovalGrantOptions,
  type FindApprovedApprovalOptions
} from "./approval-grants.js";

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
  policyDecision?: PolicyDecisionRecord;
  task?: Task;
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
  const transition = createApprovalRequestTransition(options);

  appendEventAndProject(options.database, transition.entry);

  return transition.approval;
}

export function listApprovals(options: ListApprovalsOptions = {}): ListApprovalsResult {
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

    const approval = rowToApproval(row);
    const policyDecision = findPolicyDecision(database, approval.policyDecisionId);
    const task = taskForApproval(database, approval);

    return {
      approval,
      ...(policyDecision === undefined ? {} : { policyDecision }),
      ...(task === undefined ? {} : { task }),
      stateDb
    };
  } finally {
    database.close();
  }
}

export async function decideApproval(
  options: DecideApprovalOptions
): Promise<DecideApprovalResult> {
  const subject = options.decidedBy ?? "local-admin";
  const permission = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject,
    permission: "approval.decide"
  });

  if (permission.decision !== "allow") {
    throw new Error(`Subject ${subject} cannot decide approvals: ${permission.reason}`);
  }

  const stateDb = requireRunsteadStateDbSync(options.cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    return runStateTransaction(database, () => {
      const currentApproval = readPendingApprovalForDecision(database, options.id);
      const decidedAt = (options.now ?? new Date()).toISOString();
      const approval: ApprovalRequest = {
        ...currentApproval,
        status: options.decision,
        decidedAt,
        decidedBy: subject,
        updatedAt: decidedAt
      };
      const policyDecision = findPolicyDecision(database, approval.policyDecisionId);
      const approvalTransition = createApprovalDecisionTransition({
        approval,
        ...(policyDecision === undefined ? {} : { policyDecision }),
        decidedAt
      });
      const taskTransition = createTaskTransitionForApprovalDecision(
        database,
        approval
      );

      appendEventsAndProjectsInTransaction(database, [
        approvalTransition.entry,
        ...(taskTransition === undefined ? [] : [taskTransition])
      ]);

      return {
        approval,
        event: approvalTransition.event,
        previousStatus: currentApproval.status,
        stateDb
      };
    });
  } finally {
    database.close();
  }
}

function createTaskTransitionForApprovalDecision(
  database: ReturnType<typeof openRunsteadDatabase>,
  approval: ApprovalRequest
): AppendEventAndProjectInput | undefined {
  const task = taskForApproval(database, approval);

  if (task?.status !== "waiting_approval") {
    return undefined;
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
  const event: RunsteadEvent = {
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
  };

  return {
    event,
    projection: {
      type: "task",
      value: updatedTask
    }
  };
}
