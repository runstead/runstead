import type {
  ApprovalRequest,
  JsonObject,
  PolicyDecisionRecord,
  Task,
  ToolCall,
  WorkerRun
} from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  expireApprovalGrant,
  findApprovedApprovalForAction,
  requestApproval
} from "./approvals.js";
import type { ActionEnvelope, PolicyProfile } from "./policy.js";
import { recordPolicyDecision } from "./policy-log.js";
import { finishToolCall, startToolCall } from "./runtime-audit.js";
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
  const toolCall = startToolCall({
    database: options.database,
    workerRun: options.workerRun,
    task: options.task,
    action: preflight.action,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const recordedPolicy = recordPolicyDecision({
    cwd: options.cwd,
    stateDb: options.stateDb,
    policyId: options.policy.id,
    action: preflight.action,
    result: preflight.policyResult,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  if (preflight.status === "denied") {
    const deniedToolCall = finishToolCall({
      database: options.database,
      toolCall,
      status: "denied",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        decision: preflight.policyResult.decision,
        reason: preflight.policyResult.reason
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    throw new ToolActionDeniedError(
      `${preflight.action.actionType} denied by policy: ${preflight.policyResult.reason}`,
      deniedToolCall,
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
    const approval = requestApproval({
      database: options.database,
      policyDecision: recordedPolicy.decision,
      requestedBy: options.requestedBy,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const approvalToolCall = finishToolCall({
      database: options.database,
      toolCall,
      status: "approval_required",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        approvalId: approval.id,
        decision: preflight.policyResult.decision,
        reason: preflight.policyResult.reason
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    throw new ToolActionApprovalRequiredError(
      `${preflight.action.actionType} requires approval: ${preflight.policyResult.reason}`,
      approvalToolCall,
      recordedPolicy.decision,
      approval
    );
  }

  try {
    const executed = await options.run();
    const completedToolCall = finishToolCall({
      database: options.database,
      toolCall,
      status: "completed",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        ...(executed.output ?? {}),
        ...(approvedGrant === undefined
          ? {}
          : {
              approvalId: approvedGrant.id,
              approvalGrant: "used"
            })
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    if (approvedGrant !== undefined) {
      expireApprovalGrant({
        database: options.database,
        approval: approvedGrant,
        ...(options.now === undefined ? {} : { now: options.now })
      });
    }

    return {
      value: executed.value,
      toolCall: completedToolCall,
      policyDecision: recordedPolicy.decision,
      ...(approvedGrant === undefined ? {} : { approval: approvedGrant })
    };
  } catch (error) {
    finishToolCall({
      database: options.database,
      toolCall,
      status: "failed",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        error: error instanceof Error ? error.message : String(error)
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    throw error;
  }
}
