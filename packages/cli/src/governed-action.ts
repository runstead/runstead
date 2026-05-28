import {
  assertRunsteadDatabasePath,
  appendEventsAndProjects,
  type AppendEventAndProjectInput
} from "@runstead/state-sqlite";

import {
  createApprovalExpirationTransition,
  findApprovedApprovalGrantForAction
} from "./approvals.js";
import {
  approvalGrantAuditOutput,
  approvalGrantLookupOptions
} from "./governed-action-grants.js";
import {
  recordApprovalRequiredGovernedAction,
  recordDeniedGovernedAction
} from "./governed-action-preflight-handlers.js";
import { fingerprintPolicyProfile } from "./policy.js";
import { createPolicyDecisionTransition } from "./policy-log.js";
import { createStartToolCallTransition, finishToolCall } from "./runtime-audit.js";
import { preflightToolAction } from "./tool-proxy.js";
import {
  type RunGovernedToolActionOptions,
  type RunGovernedToolActionResult
} from "./governed-action-types.js";

export {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError,
  type RunGovernedToolActionOptions,
  type RunGovernedToolActionResult
} from "./governed-action-types.js";

export async function runGovernedToolAction<T>(
  options: RunGovernedToolActionOptions<T>
): Promise<RunGovernedToolActionResult<T>> {
  assertRunsteadDatabasePath(options.database, options.stateDb);

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
    recordDeniedGovernedAction({
      database: options.database,
      preflight,
      startedToolCall,
      recordedPolicy,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  const approvedGrant =
    preflight.status === "approval_required"
      ? findApprovedApprovalGrantForAction({
          database: options.database,
          actionId: preflight.action.actionId,
          ...approvalGrantLookupOptions(preflight.action),
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : undefined;

  if (preflight.status === "approval_required" && approvedGrant === undefined) {
    recordApprovalRequiredGovernedAction({
      database: options.database,
      preflight,
      startedToolCall,
      recordedPolicy,
      requestedBy: options.requestedBy,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  const approvalGrantOutput = approvalGrantAuditOutput(approvedGrant);

  const initialEntries: AppendEventAndProjectInput[] = [
    startedToolCall.entry,
    recordedPolicy.entry
  ];

  if (approvedGrant?.reuse === "single_use") {
    const expiredGrant = createApprovalExpirationTransition({
      database: options.database,
      approval: approvedGrant.approval,
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
      ...(approvedGrant === undefined ? {} : { approval: approvedGrant.approval })
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
