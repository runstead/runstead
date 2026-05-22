import type {
  ApprovalRequest,
  JsonObject,
  PolicyDecisionRecord,
  Task,
  ToolCall,
  WorkerRun
} from "@runstead/core";
import {
  appendEventsAndProjects,
  type AppendEventAndProjectInput,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import {
  createApprovalExpirationTransition,
  createApprovalRequestTransition,
  findApprovedApprovalForAction
} from "./approvals.js";
import {
  fingerprintPolicyProfile,
  type ActionEnvelope,
  type PolicyProfile
} from "./policy.js";
import { createPolicyDecisionTransition } from "./policy-log.js";
import {
  createFinishToolCallTransition,
  createStartToolCallTransition,
  finishToolCall
} from "./runtime-audit.js";
import { preflightToolAction } from "./tool-proxy.js";

export interface RunGovernedToolActionOptions<T> {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  action: ActionEnvelope;
  requestedBy: string;
  now?: Date;
  run: () => Promise<{ value: T; output?: JsonObject }>;
}

export interface RunGovernedToolActionResult<T> {
  value: T;
  toolCall: ToolCall;
  policyDecision: PolicyDecisionRecord;
  approval?: ApprovalRequest;
}

export class ToolActionDeniedError extends Error {
  constructor(
    message: string,
    readonly toolCall: ToolCall,
    readonly policyDecision: PolicyDecisionRecord
  ) {
    super(message);
  }
}

export class ToolActionApprovalRequiredError extends Error {
  constructor(
    message: string,
    readonly toolCall: ToolCall,
    readonly policyDecision: PolicyDecisionRecord,
    readonly approval: ApprovalRequest
  ) {
    super(message);
  }
}

export async function runGovernedToolAction<T>(
  options: RunGovernedToolActionOptions<T>
): Promise<RunGovernedToolActionResult<T>> {
  const preflight = preflightToolAction({
    policy: options.policy,
    action: options.action
  });
  const startedToolCall = createStartToolCallTransition({
    workerRun: options.workerRun,
    task: options.task,
    action: preflight.action,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const recordedPolicy = createPolicyDecisionTransition({
    policyId: options.policy.id,
    policyFingerprint: fingerprintPolicyProfile(options.policy),
    action: preflight.action,
    result: preflight.policyResult,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  if (preflight.status === "denied") {
    const deniedToolCall = createFinishToolCallTransition({
      toolCall: startedToolCall.toolCall,
      status: "denied",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        decision: preflight.policyResult.decision,
        reason: preflight.policyResult.reason
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });
    appendEventsAndProjects(options.database, [
      startedToolCall.entry,
      recordedPolicy.entry,
      deniedToolCall.entry
    ]);

    throw new ToolActionDeniedError(
      `${preflight.action.actionType} denied by policy: ${preflight.policyResult.reason}`,
      deniedToolCall.toolCall,
      recordedPolicy.decision
    );
  }

  const approvedGrant =
    preflight.status === "approval_required"
      ? findApprovedApprovalForAction({
          database: options.database,
          actionId: preflight.action.actionId,
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : undefined;

  if (preflight.status === "approval_required" && approvedGrant === undefined) {
    const approval = createApprovalRequestTransition({
      policyDecision: recordedPolicy.decision,
      requestedBy: options.requestedBy,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const approvalToolCall = createFinishToolCallTransition({
      toolCall: startedToolCall.toolCall,
      status: "approval_required",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        approvalId: approval.approval.id,
        decision: preflight.policyResult.decision,
        reason: preflight.policyResult.reason
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });
    appendEventsAndProjects(options.database, [
      startedToolCall.entry,
      recordedPolicy.entry,
      approval.entry,
      approvalToolCall.entry
    ]);

    throw new ToolActionApprovalRequiredError(
      `${preflight.action.actionType} requires approval: ${preflight.policyResult.reason}`,
      approvalToolCall.toolCall,
      recordedPolicy.decision,
      approval.approval
    );
  }

  const approvalGrantOutput =
    approvedGrant === undefined
      ? {}
      : {
          approvalId: approvedGrant.id,
          approvalGrant: "used"
        };

  const initialEntries: AppendEventAndProjectInput[] = [
    startedToolCall.entry,
    recordedPolicy.entry
  ];

  if (approvedGrant !== undefined) {
    const expiredGrant = createApprovalExpirationTransition({
      database: options.database,
      approval: approvedGrant,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    initialEntries.push(expiredGrant.entry);
  }

  appendEventsAndProjects(options.database, initialEntries);

  try {
    const executed = await options.run();
    const completedToolCall = finishToolCall({
      database: options.database,
      toolCall: startedToolCall.toolCall,
      status: "completed",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        ...(executed.output ?? {}),
        ...approvalGrantOutput
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      value: executed.value,
      toolCall: completedToolCall,
      policyDecision: recordedPolicy.decision,
      ...(approvedGrant === undefined ? {} : { approval: approvedGrant })
    };
  } catch (error) {
    finishToolCall({
      database: options.database,
      toolCall: startedToolCall.toolCall,
      status: "failed",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        error: error instanceof Error ? error.message : String(error),
        ...approvalGrantOutput
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    throw error;
  }
}
