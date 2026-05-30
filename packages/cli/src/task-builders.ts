import { resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import type { TaskType } from "@runstead/domain-packs";
import type { LocalAgentWorkerKind } from "./local-agent.js";

import {
  inspectBuildCommand,
  inspectLintCommand,
  inspectTestCommand,
  inspectTypecheckCommand,
  type PackageScriptCommandInspection
} from "./repo-inspection.js";

export interface BuildRunLocalVerifiersTaskOptions {
  cwd?: string;
  goal: Goal;
  now?: Date;
}

export interface BuildDomainTaskOptions {
  cwd?: string;
  goal: Goal;
  taskType: TaskType;
  now?: Date;
}

export async function buildRunLocalVerifiersTask(
  options: BuildRunLocalVerifiersTaskOptions
): Promise<{ task: Task; event: RunsteadEvent }> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const createdAt = (options.now ?? new Date()).toISOString();
  const [testCommand, lintCommand] = await Promise.all([
    inspectTestCommand(cwd),
    inspectLintCommand(cwd)
  ]);
  const commands = [
    verifierCommand("test", testCommand),
    verifierCommand("lint", lintCommand)
  ].filter((command) => command !== undefined);
  const task: Task = {
    id: createRunsteadId("task"),
    goalId: options.goal.id,
    domain: options.goal.domain,
    type: "run_local_verifiers",
    status: "queued",
    priority: "medium",
    attempt: 0,
    maxAttempts: 1,
    input: {
      repositoryPath: goalRepositoryPath(options.goal, cwd),
      commands
    },
    verifiers: commands.map((command) => `command:${command.name}`),
    createdAt,
    updatedAt: createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      commands
    },
    createdAt
  };

  return {
    task,
    event
  };
}

export async function buildCommandVerifierDomainTask(
  options: BuildDomainTaskOptions
): Promise<{ task: Task; event: RunsteadEvent }> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const generated = buildDomainTask(options);
  const commands = await inspectCommandVerifierScripts(cwd);
  const task: Task = {
    ...generated.task,
    input: {
      ...generated.task.input,
      commands
    }
  };
  const event: RunsteadEvent = {
    ...generated.event,
    payload: {
      ...generated.event.payload,
      commands
    }
  };

  return {
    task,
    event
  };
}

export function buildDomainTask(options: BuildDomainTaskOptions): {
  task: Task;
  event: RunsteadEvent;
} {
  const cwd = resolve(options.cwd ?? process.cwd());
  const createdAt = (options.now ?? new Date()).toISOString();
  const task: Task = {
    id: createRunsteadId("task"),
    goalId: options.goal.id,
    domain: options.goal.domain,
    type: options.taskType.id,
    status: "queued",
    priority: options.taskType.defaultPriority,
    attempt: 0,
    maxAttempts: options.taskType.maxAttempts,
    input: {
      repositoryPath: goalRepositoryPath(options.goal, cwd),
      taskType: options.taskType.id,
      description: options.taskType.description,
      workerRouting: options.taskType.workerRouting,
      ...domainTaskAgentInput({
        goal: options.goal,
        taskType: options.taskType
      })
    },
    verifiers: [...options.taskType.verifiers.required],
    createdAt,
    updatedAt: createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      workerRouting: options.taskType.workerRouting,
      verifiers: task.verifiers
    },
    createdAt
  };

  return {
    task,
    event
  };
}

function domainTaskAgentInput(input: {
  goal: Goal;
  taskType: TaskType;
}): Partial<Task["input"]> {
  const worker = firstAgentWorker(input.taskType.workerRouting);

  if (worker === undefined) {
    return {};
  }

  return {
    prompt: [
      `Run the ${input.goal.domain} domain task ${input.taskType.id}.`,
      "",
      `Goal: ${input.goal.title}`,
      `Task description: ${input.taskType.description}`,
      `Required verifiers: ${input.taskType.verifiers.required.join(", ")}`,
      "",
      "Work within the Runstead capability policy for this domain pack.",
      "Record a concise completion summary and call out missing evidence explicitly."
    ].join("\n"),
    worker,
    mode: "read-only",
    learningReview: false
  };
}

function firstAgentWorker(
  routing: TaskType["workerRouting"]
): LocalAgentWorkerKind | undefined {
  const workers = [routing.preferred, ...(routing.fallback ?? [])];

  return workers.find(isAgentWorker);
}

function isAgentWorker(value: string): value is LocalAgentWorkerKind {
  return value === "codex_cli" || value === "codex_direct" || value === "claude_code";
}

interface LocalVerifierCommand {
  name: "test" | "lint" | "typecheck" | "build";
  command: string;
  rawScript: string;
}

async function inspectCommandVerifierScripts(
  cwd: string
): Promise<LocalVerifierCommand[]> {
  const [testCommand, lintCommand, typecheckCommand, buildCommand] = await Promise.all([
    inspectTestCommand(cwd),
    inspectLintCommand(cwd),
    inspectTypecheckCommand(cwd),
    inspectBuildCommand(cwd)
  ]);

  return [
    verifierCommand("test", testCommand),
    verifierCommand("lint", lintCommand),
    verifierCommand("typecheck", typecheckCommand),
    verifierCommand("build", buildCommand)
  ].filter((command) => command !== undefined);
}

function verifierCommand(
  name: LocalVerifierCommand["name"],
  inspection: PackageScriptCommandInspection
): LocalVerifierCommand | undefined {
  if (!inspection.detected || inspection.command === undefined) {
    return undefined;
  }

  return {
    name,
    command: inspection.command,
    rawScript: inspection.rawScript ?? ""
  };
}

function goalRepositoryPath(goal: Goal, cwd: string): string {
  const repositoryPath = goal.scope.repositoryPath;

  return typeof repositoryPath === "string" ? repositoryPath : cwd;
}
