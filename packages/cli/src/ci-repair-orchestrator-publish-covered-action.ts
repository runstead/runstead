import type { JsonObject, Task, WorkerRun } from "@runstead/core";
import { appendEventsAndProjects, type RunsteadDatabase } from "@runstead/state-sqlite";

import type { PublishCoverage } from "./ci-repair-orchestrator-context.js";
import { coveredByOutput } from "./ci-repair-orchestrator-output.js";
import { errorMessage } from "./ci-repair-orchestrator-task-state.js";
import { ToolActionDeniedError } from "./governed-action.js";
import {
  createFinishToolCallTransition,
  createStartToolCallTransition,
  finishToolCall
} from "./runtime-audit.js";
import {
  fingerprintPolicyProfile,
  type ActionEnvelope,
  type PolicyProfile
} from "./policy.js";
import { createPolicyDecisionTransition } from "./policy-log.js";
import { preflightToolAction } from "./tool-proxy.js";

export async function runPublishCoveredToolAction<T>(options: {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  action: ActionEnvelope;
  coverage?: PublishCoverage;
  approvalId?: string;
  now?: Date;
  run: () => Promise<{ value: T; output?: JsonObject }>;
}): Promise<T> {
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
        reason: preflight.policyResult.reason,
        coveredByActionType: "repo.publish_repair",
        ...(options.coverage === undefined ? {} : coveredByOutput(options.coverage)),
        ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId })
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

  appendEventsAndProjects(options.database, [
    startedToolCall.entry,
    recordedPolicy.entry
  ]);

  try {
    const executed = await options.run();
    finishToolCall({
      database: options.database,
      toolCall: startedToolCall.toolCall,
      status: "completed",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        ...(executed.output ?? {}),
        coveredByActionType: "repo.publish_repair",
        ...(options.coverage === undefined ? {} : coveredByOutput(options.coverage)),
        ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId })
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return executed.value;
  } catch (error) {
    finishToolCall({
      database: options.database,
      toolCall: startedToolCall.toolCall,
      status: "failed",
      policyDecisionId: recordedPolicy.decision.id,
      output: {
        error: errorMessage(error),
        coveredByActionType: "repo.publish_repair",
        ...(options.coverage === undefined ? {} : coveredByOutput(options.coverage)),
        ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId })
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    throw error;
  }
}
