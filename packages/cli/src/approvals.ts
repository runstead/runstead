import {
  ApprovalRequestSchema,
  createRunsteadId,
  type ApprovalRequest,
  type JsonObject,
  type PolicyDecisionRecord,
  PolicyDecisionRecordSchema,
  type RunsteadEvent,
  type Task,
  TaskSchema
} from "@runstead/core";
import {
  appendEventAndProject,
  appendEventsAndProjectsInTransaction,
  openRunsteadDatabase,
  runStateTransaction,
  type AppendEventAndProjectInput,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import { checkPermission } from "./rbac.js";
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
  policyDecision?: PolicyDecisionRecord;
  task?: Task;
  stateDb: string;
}

export interface ApprovalActionMetadata {
  filesTouched: string[];
  dependencyImpact: {
    kind: string;
    files: string[];
  };
  diffHash?: string;
  riskClass?: string;
  canonicalSignature?: string;
  riskSummary?: string;
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
  canonicalSignature?: string;
  approvalGrantScope?: string;
  now?: Date;
}

export type ApprovalGrantMatchKind =
  | "action_id"
  | "canonical_signature"
  | "approval_grant_scope";

export interface ApprovedApprovalGrant {
  approval: ApprovalRequest;
  match: ApprovalGrantMatchKind;
  approvedActionId: string;
  canonicalSignature?: string;
  approvalGrantScope?: string;
  reuse: "single_use" | "scoped_until_expiry";
}

export interface ExpireApprovalGrantOptions {
  database: ReturnType<typeof openRunsteadDatabase>;
  approval: ApprovalRequest;
  now?: Date;
}

export interface ApprovalTransition {
  approval: ApprovalRequest;
  event: RunsteadEvent;
  entry: AppendEventAndProjectInput;
}

export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export function createApprovalRequestTransition(
  options: Omit<RequestApprovalOptions, "database">
): ApprovalTransition {
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const expiresAt =
    options.expiresAt ??
    new Date(now.getTime() + DEFAULT_APPROVAL_TTL_MS).toISOString();
  const approval = ApprovalRequestSchema.parse({
    id: createRunsteadId("appr"),
    policyDecisionId: options.policyDecision.id,
    actionId: options.policyDecision.actionId,
    status: "pending",
    risk: options.policyDecision.risk,
    reason: options.policyDecision.reason,
    requestedBy: options.requestedBy ?? "runstead",
    expiresAt,
    createdAt,
    updatedAt: createdAt
  });
  const event = approvalEvent(
    "approval.requested",
    approval,
    approvalPayload(approval, options.policyDecision),
    createdAt
  );

  return {
    approval,
    event,
    entry: {
      event,
      projection: {
        type: "approval",
        value: approval
      }
    }
  };
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

export function approvalActionMetadata(
  policyDecision: PolicyDecisionRecord | undefined
): ApprovalActionMetadata {
  const action = isRecord(policyDecision?.action) ? policyDecision.action : {};
  const context = isRecord(action.context) ? action.context : {};
  const dependencyImpact = isRecord(context.dependencyImpact)
    ? context.dependencyImpact
    : {};

  return {
    filesTouched: stringArrayValue(context.filesTouched),
    dependencyImpact: {
      kind:
        typeof dependencyImpact.kind === "string" ? dependencyImpact.kind : "unknown",
      files: stringArrayValue(dependencyImpact.files)
    },
    ...(typeof context.diffHash === "string" ? { diffHash: context.diffHash } : {}),
    ...(typeof context.riskClass === "string" ? { riskClass: context.riskClass } : {}),
    ...(typeof context.canonicalSignature === "string"
      ? { canonicalSignature: context.canonicalSignature }
      : {}),
    ...(typeof context.riskSummary === "string"
      ? { riskSummary: context.riskSummary }
      : {})
  };
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

export function findApprovedApprovalForAction(
  options: FindApprovedApprovalOptions
): ApprovalRequest | undefined {
  return findApprovedApprovalGrantForAction(options)?.approval;
}

export function findApprovedApprovalGrantForAction(
  options: FindApprovedApprovalOptions
): ApprovedApprovalGrant | undefined {
  const now = options.now ?? new Date();
  const rows = options.database
    .prepare(
      `
      SELECT a.id, a.policy_decision_id, a.action_id, a.status, a.risk, a.reason,
             a.requested_by, a.expires_at, a.decided_at, a.decided_by,
             a.created_at, a.updated_at, pd.action_json
      FROM approvals a
      LEFT JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.status = 'approved'
      ORDER BY a.decided_at ASC, a.created_at ASC, a.id ASC
    `
    )
    .all() as unknown as ApprovedApprovalRow[];

  for (const row of rows) {
    const grantMatch = approvedApprovalGrantMatch(row, options);

    if (grantMatch === undefined) {
      continue;
    }

    const approval = rowToApproval(row);

    if (
      approval.expiresAt !== undefined &&
      Date.parse(approval.expiresAt) <= now.getTime()
    ) {
      expireApprovalGrant({
        database: options.database,
        approval,
        now
      });
      continue;
    }

    return {
      approval,
      match: grantMatch.match,
      approvedActionId: row.action_id,
      reuse: grantMatch.reuse,
      ...(grantMatch.canonicalSignature === undefined
        ? {}
        : { canonicalSignature: grantMatch.canonicalSignature }),
      ...(grantMatch.approvalGrantScope === undefined
        ? {}
        : { approvalGrantScope: grantMatch.approvalGrantScope })
    };
  }

  return undefined;
}

export function createApprovalExpirationTransition(
  options: ExpireApprovalGrantOptions
): ApprovalTransition {
  const expiredAt = (options.now ?? new Date()).toISOString();
  const approval: ApprovalRequest = {
    ...options.approval,
    status: "expired",
    updatedAt: expiredAt
  };
  const event = approvalEvent(
    "approval.expired",
    approval,
    approvalPayload(
      approval,
      findPolicyDecision(options.database, approval.policyDecisionId)
    ),
    expiredAt
  );

  return {
    approval,
    event,
    entry: {
      event,
      projection: {
        type: "approval",
        value: approval
      }
    }
  };
}

export function expireApprovalGrant(
  options: ExpireApprovalGrantOptions
): ApprovalRequest {
  const transition = createApprovalExpirationTransition(options);

  appendEventAndProject(options.database, transition.entry);

  return transition.approval;
}

function createApprovalDecisionTransition(options: {
  approval: ApprovalRequest;
  policyDecision?: PolicyDecisionRecord;
  decidedAt: string;
}): ApprovalTransition {
  const event = approvalEvent(
    options.approval.status === "approved" ? "approval.approved" : "approval.denied",
    options.approval,
    approvalPayload(options.approval, options.policyDecision),
    options.decidedAt
  );

  return {
    approval: options.approval,
    event,
    entry: {
      event,
      projection: {
        type: "approval",
        value: options.approval
      }
    }
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

function approvalPayload(
  approval: ApprovalRequest,
  policyDecision?: PolicyDecisionRecord
): JsonObject {
  const policyFingerprint = policyDecision?.result.policyFingerprint;

  return {
    approvalId: approval.id,
    policyDecisionId: approval.policyDecisionId,
    actionId: approval.actionId,
    status: approval.status,
    risk: approval.risk,
    reason: approval.reason,
    ...(policyDecision === undefined
      ? {}
      : {
          policyId: policyDecision.policyId,
          action: policyDecision.action,
          obligations: policyDecision.obligations,
          ...(typeof policyFingerprint === "string" ? { policyFingerprint } : {})
        }),
    ...(approval.expiresAt === undefined ? {} : { expiresAt: approval.expiresAt }),
    ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
    ...(approval.decidedBy === undefined ? {} : { decidedBy: approval.decidedBy })
  };
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

function taskForApproval(
  database: RunsteadDatabase,
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

function readPendingApprovalForDecision(
  database: RunsteadDatabase,
  id: string
): ApprovalRequest {
  const pendingRow = database
    .prepare(
      `
      SELECT id, policy_decision_id, action_id, status, risk, reason,
             requested_by, expires_at, decided_at, decided_by,
             created_at, updated_at
      FROM approvals
      WHERE id = ? AND status = 'pending'
    `
    )
    .get(id) as ApprovalRow | undefined;

  if (pendingRow !== undefined) {
    return rowToApproval(pendingRow);
  }

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
    .get(id) as ApprovalRow | undefined;

  if (row === undefined) {
    throw new Error(`Approval not found: ${id}`);
  }

  const approval = rowToApproval(row);

  throw new Error(`Approval ${id} is ${approval.status}, expected pending`);
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

interface ApprovedApprovalRow extends ApprovalRow {
  action_json: string | null;
}

interface PolicyDecisionRow {
  id: string;
  action_id: string;
  policy_id: string;
  decision: string;
  risk: string;
  rule_id: string | null;
  reason: string;
  obligations_json: string;
  action_json: string;
  result_json: string;
  created_at: string;
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

function findPolicyDecision(
  database: RunsteadDatabase,
  id: string
): PolicyDecisionRecord | undefined {
  const row = database
    .prepare(
      `
      SELECT id, action_id, policy_id, decision, risk, rule_id, reason,
             obligations_json, action_json, result_json, created_at
      FROM policy_decisions
      WHERE id = ?
    `
    )
    .get(id) as PolicyDecisionRow | undefined;

  return row === undefined ? undefined : rowToPolicyDecision(row);
}

function rowToPolicyDecision(row: PolicyDecisionRow): PolicyDecisionRecord {
  return PolicyDecisionRecordSchema.parse({
    id: row.id,
    actionId: row.action_id,
    policyId: row.policy_id,
    decision: row.decision,
    risk: row.risk,
    ...(row.rule_id === null ? {} : { ruleId: row.rule_id }),
    reason: row.reason,
    obligations: JSON.parse(row.obligations_json) as string[],
    action: JSON.parse(row.action_json) as JsonObject,
    result: JSON.parse(row.result_json) as JsonObject,
    createdAt: row.created_at
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

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function approvedApprovalGrantMatch(
  row: ApprovedApprovalRow,
  options: FindApprovedApprovalOptions
):
  | {
      match: ApprovalGrantMatchKind;
      canonicalSignature?: string;
      approvalGrantScope?: string;
      reuse: "single_use" | "scoped_until_expiry";
    }
  | undefined {
  const reuse = approvalActionGrantReuse(row.action_json);

  if (row.action_id === options.actionId) {
    return { match: "action_id", reuse };
  }

  const canonicalSignature = approvalActionCanonicalSignature(row.action_json);

  if (
    options.canonicalSignature !== undefined &&
    canonicalSignature === options.canonicalSignature
  ) {
    return {
      match: "canonical_signature",
      canonicalSignature,
      reuse
    };
  }

  const approvalGrantScope = approvalActionGrantScope(row.action_json);

  if (
    reuse === "scoped_until_expiry" &&
    options.approvalGrantScope !== undefined &&
    approvalGrantScope === options.approvalGrantScope
  ) {
    return {
      match: "approval_grant_scope",
      approvalGrantScope,
      reuse
    };
  }

  return undefined;
}

function approvalActionCanonicalSignature(
  actionJson: string | null
): string | undefined {
  if (actionJson === null) {
    return undefined;
  }

  try {
    const action = JSON.parse(actionJson) as unknown;
    const context = isRecord(action) && isRecord(action.context) ? action.context : {};

    return typeof context.canonicalSignature === "string"
      ? context.canonicalSignature
      : undefined;
  } catch {
    return undefined;
  }
}

function approvalActionGrantReuse(
  actionJson: string | null
): "single_use" | "scoped_until_expiry" {
  if (actionJson === null) {
    return "single_use";
  }

  try {
    const action = JSON.parse(actionJson) as unknown;
    const context = isRecord(action) && isRecord(action.context) ? action.context : {};
    const approvalGrant = isRecord(context.approvalGrant) ? context.approvalGrant : {};

    return approvalGrant.mode === "scoped_until_expiry"
      ? "scoped_until_expiry"
      : "single_use";
  } catch {
    return "single_use";
  }
}

function approvalActionGrantScope(actionJson: string | null): string | undefined {
  if (actionJson === null) {
    return undefined;
  }

  try {
    const action = JSON.parse(actionJson) as unknown;
    const context = isRecord(action) && isRecord(action.context) ? action.context : {};
    const approvalGrant = isRecord(context.approvalGrant) ? context.approvalGrant : {};

    return typeof approvalGrant.scope === "string" ? approvalGrant.scope : undefined;
  } catch {
    return undefined;
  }
}
