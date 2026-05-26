import { resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import type { TaskType } from "@runstead/domain-packs";

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
      workerRouting: options.taskType.workerRouting
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
