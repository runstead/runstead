import { createRunsteadId, type RunsteadEvent, type Task } from "@runstead/core";

import type { CommandVerifierInput } from "./verifier-evidence.js";

export function createQueuedCiRepairTask(input: {
  goalId: string;
  runId: string;
  verifierCommands?: CommandVerifierInput[];
  createdAt: string;
}): { task: Task; event: RunsteadEvent } {
  const task: Task = {
    id: createRunsteadId("task"),
    goalId: input.goalId,
    domain: "repo-maintenance",
    type: "ci_repair",
    status: "queued",
    priority: "high",
    attempt: 0,
    maxAttempts: 1,
    input: {
      source: "github_actions",
      runId: input.runId,
      intake: {
        governed: true
      },
      ...(input.verifierCommands === undefined
        ? {}
        : { commands: input.verifierCommands })
    },
    verifiers: [
      "evidence:github_workflow_run",
      ...(input.verifierCommands ?? []).map((command) => `command:${command.name}`),
      ...(input.verifierCommands === undefined ? ["command:local_verifiers"] : [])
    ],
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      runId: input.runId,
      intake: "governed"
    },
    createdAt: input.createdAt
  };

  return { task, event };
}
