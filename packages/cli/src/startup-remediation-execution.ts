import { createRunsteadId, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { type RunLocalAgentTaskResult } from "./local-agent.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { addStartupEvidence, type StartupGateStage } from "./startup-evidence.js";
import { jsonStringArray } from "./startup-remediation-guidance.js";
import type {
  StartupRemediationExecutionSummary,
  StartupRemediationTaskSummary
} from "./startup-remediation.js";

export function remediationWorkerPrompt(item: StartupRemediationTaskSummary): string {
  return [
    "Resolve the Runstead startup readiness blocker below.",
    "",
    `Blocker: ${item.blocker}`,
    `Stage: ${String(item.task.input.stage)}`,
    `Scope: ${String(item.task.input.scope)}`,
    `Expected evidence: ${jsonStringArray(item.task.input.expectedEvidence).join(", ")}`,
    `Acceptance criteria: ${item.acceptanceCriteria.join("; ")}`,
    `Depends on: ${item.dependsOn.length === 0 ? "none" : item.dependsOn.join(", ")}`,
    `Verifier: ${String(item.task.input.verifier)}`,
    "",
    "After implementation, record or refresh the relevant Runstead startup evidence and leave the repo in a verifier-ready state.",
    "Do not push, publish, or change unrelated product scope."
  ].join("\n");
}

export async function recordRemediationExecution(input: {
  cwd: string;
  task: Task;
  execution: StartupRemediationExecutionSummary;
  now?: Date;
}): Promise<void> {
  const resolvedState = await requireRunsteadStateDb(input.cwd);
  const updatedAt = (input.now ?? new Date()).toISOString();
  const status = remediationTaskStatus(input.execution);
  const task: Task = {
    ...input.task,
    status,
    attempt: input.task.attempt + 1,
    output: {
      ...input.task.output,
      execution: {
        localAgentTaskId: input.execution.localAgentTaskId,
        status: input.execution.status,
        summary: input.execution.summary,
        resolved: input.execution.resolved,
        remainingBlockers: input.execution.remainingBlockers,
        gateEventId: input.execution.gateEventId
      }
    },
    updatedAt
  };
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: createRunsteadId("evt"),
        type: "task.remediation_executed",
        aggregateType: "task",
        aggregateId: task.id,
        payload: task.output ?? {},
        createdAt: updatedAt
      },
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }
}

export function remediationTaskStatus(
  execution: StartupRemediationExecutionSummary
): Task["status"] {
  if (execution.status === "waiting_approval") {
    return "waiting_approval";
  }

  if (execution.status === "failed" || execution.status === "blocked") {
    return execution.status;
  }

  return execution.resolved ? "completed" : "blocked";
}

export function remediationExecutionOutcome(
  finalGatePassed: boolean,
  executed: StartupRemediationExecutionSummary[]
): "clear" | "partial" | "blocked" {
  if (finalGatePassed) {
    return "clear";
  }

  return executed.some((item) => item.resolved) ? "partial" : "blocked";
}

export async function recordRemediationFailureEvidence(input: {
  cwd: string;
  stage: StartupGateStage;
  blocker: string;
  localAgentTaskId: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  remainingBlockers: string[];
  now?: Date;
}): Promise<Awaited<ReturnType<typeof addStartupEvidence>>> {
  return addStartupEvidence({
    cwd: input.cwd,
    type: "remediation_failure",
    summary: `Remediation unresolved: ${input.blocker}`,
    gate: input.stage,
    blocker: input.blocker,
    content: JSON.stringify(
      {
        localAgentTaskId: input.localAgentTaskId,
        status: input.status,
        summary: input.summary,
        remainingBlockers: input.remainingBlockers,
        nextAction: "review blocker evidence or rerun remediation with tighter scope"
      },
      null,
      2
    ),
    ...(input.now === undefined ? {} : { now: input.now })
  });
}
