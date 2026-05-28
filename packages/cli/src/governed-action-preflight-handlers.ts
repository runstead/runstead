import type { PolicyDecisionRecord } from "@runstead/core";
import { appendEventsAndProjects, type RunsteadDatabase } from "@runstead/state-sqlite";

import { createApprovalRequestTransition } from "./approvals.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action-types.js";
import type { PolicyDecisionTransition } from "./policy-log.js";
import { createFinishToolCallTransition } from "./runtime-audit.js";
import type { ToolCallTransition } from "./runtime-audit-tool-call.js";
import type { ToolProxyPreflightResult } from "./tool-proxy.js";

export function recordDeniedGovernedAction(input: {
  database: RunsteadDatabase;
  preflight: ToolProxyPreflightResult;
  startedToolCall: ToolCallTransition;
  recordedPolicy: PolicyDecisionTransition;
  now?: Date;
}): never {
  const deniedToolCall = createFinishToolCallTransition({
    toolCall: input.startedToolCall.toolCall,
    status: "denied",
    policyDecisionId: input.recordedPolicy.decision.id,
    output: {
      decision: input.preflight.policyResult.decision,
      reason: input.preflight.policyResult.reason
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });

  appendEventsAndProjects(input.database, [
    input.startedToolCall.entry,
    input.recordedPolicy.entry,
    deniedToolCall.entry
  ]);

  throw new ToolActionDeniedError(
    `${input.preflight.action.actionType} denied by policy: ${input.preflight.policyResult.reason}`,
    deniedToolCall.toolCall,
    input.recordedPolicy.decision
  );
}

export function recordApprovalRequiredGovernedAction(input: {
  database: RunsteadDatabase;
  preflight: ToolProxyPreflightResult;
  startedToolCall: ToolCallTransition;
  recordedPolicy: {
    decision: PolicyDecisionRecord;
    entry: PolicyDecisionTransition["entry"];
  };
  requestedBy: string;
  now?: Date;
}): never {
  const approval = createApprovalRequestTransition({
    policyDecision: input.recordedPolicy.decision,
    requestedBy: input.requestedBy,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const approvalToolCall = createFinishToolCallTransition({
    toolCall: input.startedToolCall.toolCall,
    status: "approval_required",
    policyDecisionId: input.recordedPolicy.decision.id,
    output: {
      approvalId: approval.approval.id,
      decision: input.preflight.policyResult.decision,
      reason: input.preflight.policyResult.reason
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });

  appendEventsAndProjects(input.database, [
    input.startedToolCall.entry,
    input.recordedPolicy.entry,
    approval.entry,
    approvalToolCall.entry
  ]);

  throw new ToolActionApprovalRequiredError(
    `${input.preflight.action.actionType} requires approval: ${input.preflight.policyResult.reason}`,
    approvalToolCall.toolCall,
    input.recordedPolicy.decision,
    approval.approval
  );
}
