import { createRunsteadId, type Task } from "@runstead/core";
import { appendEventAndProject } from "@runstead/state-sqlite";
import type { RunsteadEvidenceCollector } from "@runstead/sdk";

import { createLocalAgentTask, type LocalAgentWorkerKind } from "./local-agent.js";
import type { ActionEnvelope } from "./policy.js";

export async function createExtensionCollectorTask(input: {
  cwd: string;
  worker: LocalAgentWorkerKind;
  now?: Date;
}): Promise<Task> {
  const created = await createLocalAgentTask({
    cwd: input.cwd,
    title: "Run startup extension collectors",
    prompt:
      "Collect extension-defined readiness evidence using governed local commands.",
    worker: input.worker,
    mode: "read-only",
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return created.task;
}

export function startExtensionCollectorTask(
  database: Parameters<typeof appendEventAndProject>[0],
  task: Task,
  now?: Date
): Task {
  const updatedAt = (now ?? new Date()).toISOString();
  const runningTask: Task = {
    ...task,
    status: "running",
    attempt: task.attempt + 1,
    updatedAt
  };

  appendEventAndProject(database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "task.started",
      aggregateType: "task",
      aggregateId: runningTask.id,
      payload: {
        taskId: runningTask.id,
        attempt: runningTask.attempt
      },
      createdAt: updatedAt
    },
    projection: {
      type: "task",
      value: runningTask
    }
  });

  return runningTask;
}

export function finishExtensionCollectorTask(
  database: Parameters<typeof appendEventAndProject>[0],
  task: Task,
  blockers: string[],
  now?: Date
): void {
  const updatedAt = (now ?? new Date()).toISOString();
  const status = blockers.length === 0 ? "completed" : "failed";
  const completedTask: Task = {
    ...task,
    status,
    output: {
      summary:
        blockers.length === 0
          ? "Extension collectors completed"
          : "Extension collectors failed",
      blockers
    },
    updatedAt
  };

  appendEventAndProject(database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: `task.${status}`,
      aggregateType: "task",
      aggregateId: completedTask.id,
      payload: {
        taskId: completedTask.id,
        status,
        blockers
      },
      createdAt: updatedAt
    },
    projection: {
      type: "task",
      value: completedTask
    }
  });
}

export function extensionCollectorAction(input: {
  task: Task;
  extensionId: string;
  collector: RunsteadEvidenceCollector;
  cwd: string;
}): ActionEnvelope {
  return {
    actionId: `act_${input.task.id}_${input.extensionId}_${input.collector.id}`,
    actionType: "shell.exec",
    resource: {
      type: "shell",
      id: `extension:${input.extensionId}/${input.collector.id}`
    },
    context: {
      cwd: input.cwd,
      ...(input.collector.command === undefined
        ? {}
        : { command: input.collector.command }),
      riskClass: "extension_collector",
      secretsRequested: [...input.collector.requiredSecrets],
      sideEffects:
        input.collector.qualityTier === "external_observed"
          ? ["network_read_external"]
          : ["local_read"]
    }
  };
}
