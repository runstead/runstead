import { resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type { CiRepairWorkerKind } from "./ci-repair-orchestrator.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export const LOCAL_AGENT_TASK_TYPE = "local_agent_task";

export type LocalAgentMode = "read-only" | "edit" | "repair";
export type LocalAgentWorkerKind = CiRepairWorkerKind;

export interface CreateLocalAgentTaskOptions {
  cwd?: string;
  prompt: string;
  title?: string;
  worker?: LocalAgentWorkerKind;
  model?: string;
  mode?: LocalAgentMode;
  allowedPaths?: string[];
  deniedPaths?: string[];
  verifierCommands?: CommandVerifierInput[];
  maxTurns?: number;
  checkpoint?: boolean;
  commit?: boolean;
  now?: Date;
}

export interface CreateLocalAgentTaskResult {
  stateDb: string;
  goal: Goal;
  task: Task;
  events: RunsteadEvent[];
}

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

export function isLocalAgentTask(task: Task): boolean {
  return task.domain === "repo-maintenance" && task.type === LOCAL_AGENT_TASK_TYPE;
}

function localAgentTaskInput(input: {
  cwd: string;
  prompt: string;
  worker: LocalAgentWorkerKind;
  mode: LocalAgentMode;
  options: CreateLocalAgentTaskOptions;
}): Task["input"] {
  return {
    repositoryPath: input.cwd,
    prompt: input.prompt,
    worker: input.worker,
    mode: input.mode,
    ...(input.options.model === undefined ? {} : { model: input.options.model }),
    ...(input.options.allowedPaths === undefined
      ? {}
      : { allowedPaths: input.options.allowedPaths }),
    ...(input.options.deniedPaths === undefined
      ? {}
      : { deniedPaths: input.options.deniedPaths }),
    ...(input.options.verifierCommands === undefined
      ? {}
      : { commands: input.options.verifierCommands }),
    ...(input.options.maxTurns === undefined ? {} : { maxTurns: input.options.maxTurns }),
    ...(input.options.checkpoint === undefined
      ? {}
      : { checkpoint: input.options.checkpoint }),
    ...(input.options.commit === undefined ? {} : { commit: input.options.commit })
  };
}

function localAgentEvent(
  type: string,
  aggregateType: string,
  aggregateId: string,
  createdAt: string,
  payload: RunsteadEvent["payload"]
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType,
    aggregateId,
    payload,
    createdAt
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
