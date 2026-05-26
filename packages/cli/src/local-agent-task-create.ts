import { resolve } from "node:path";

import { createRunsteadId, type Goal, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { localAgentEvent } from "./local-agent-actions.js";
import { localAgentTaskInput } from "./local-agent-prompt.js";
import {
  LOCAL_AGENT_TASK_TYPE,
  type CreateLocalAgentTaskOptions,
  type CreateLocalAgentTaskResult
} from "./local-agent-types.js";
import { requireRunsteadStateDb } from "./runstead-root.js";

export async function createLocalAgentTask(
  options: CreateLocalAgentTaskOptions
): Promise<CreateLocalAgentTaskResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const prompt = requireNonEmptyString(options.prompt, "prompt");
  const mode = options.mode ?? "read-only";
  const worker = options.worker ?? "codex_direct";
  const resolvedState = await requireRunsteadStateDb(cwd);
  const createdAt = (options.now ?? new Date()).toISOString();
  const goal: Goal = {
    id: createRunsteadId("goal"),
    domain: "repo-maintenance",
    title: options.title ?? localAgentTitle(prompt),
    status: "active",
    priority: mode === "read-only" ? "low" : "medium",
    scope: {
      repositoryPath: cwd,
      taskType: LOCAL_AGENT_TASK_TYPE,
      mode,
      worker
    },
    policyRef: "policy_repo_maintenance_v1",
    createdAt,
    updatedAt: createdAt
  };
  const task: Task = {
    id: createRunsteadId("task"),
    goalId: goal.id,
    domain: goal.domain,
    type: LOCAL_AGENT_TASK_TYPE,
    status: "queued",
    priority: goal.priority,
    attempt: 0,
    maxAttempts: 1,
    input: localAgentTaskInput({
      cwd,
      prompt,
      worker,
      mode,
      options
    }),
    verifiers: (options.verifierCommands ?? []).map(
      (command) => `command:${command.name}`
    ),
    createdAt,
    updatedAt: createdAt
  };
  const goalEvent = localAgentEvent("goal.created", "goal", goal.id, createdAt, {
    domain: goal.domain,
    title: goal.title,
    repositoryPath: cwd,
    taskType: LOCAL_AGENT_TASK_TYPE,
    mode,
    worker
  });
  const taskEvent = localAgentEvent("task.created", "task", task.id, createdAt, {
    goalId: task.goalId,
    type: task.type,
    mode,
    worker
  });
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    appendEventAndProject(database, {
      event: goalEvent,
      projection: {
        type: "goal",
        value: goal
      }
    });
    appendEventAndProject(database, {
      event: taskEvent,
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }

  return {
    stateDb: resolvedState.stateDb,
    goal,
    task,
    events: [goalEvent, taskEvent]
  };
}

function localAgentTitle(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const title = firstLine ?? "Local agent task";

  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Local agent ${field} is required`);
  }

  return trimmed;
}
