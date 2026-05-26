import type { Task } from "@runstead/core";
import type { CommandVerifierInput } from "@runstead/verifiers";

import { collectRepoInspection } from "./inspection-evidence.js";
import { claimTask, showTask } from "./tasks.js";

export function loadVerifierTask(input: {
  cwd: string;
  taskId: string;
  claim?: boolean;
  now?: Date;
}): Task {
  if (input.claim === false) {
    const task = showTask({ cwd: input.cwd, id: input.taskId }).task;

    if (task.status !== "claimed" && task.status !== "running") {
      throw new Error(
        `Task ${input.taskId} is ${task.status}, expected claimed or running`
      );
    }

    return task;
  }

  return claimTask({
    cwd: input.cwd,
    id: input.taskId,
    ...(input.now === undefined ? {} : { now: input.now })
  }).task;
}

export async function verifierCommandsFromTask(input: {
  cwd: string;
  task: Task;
  now?: Date;
}): Promise<CommandVerifierInput[]> {
  const configured = configuredVerifierCommandsFromTask(input.task);

  if (configured.length > 0 || input.task.type !== "run_mvp_verifiers") {
    return configured;
  }

  const inspection = await collectRepoInspection(
    input.cwd,
    (input.now ?? new Date()).toISOString()
  );

  return [
    discoveredVerifierCommand("test", inspection.commands.test.command),
    discoveredVerifierCommand("lint", inspection.commands.lint.command),
    discoveredVerifierCommand("typecheck", inspection.commands.typecheck.command),
    discoveredVerifierCommand("build", inspection.commands.build.command)
  ].filter((command): command is CommandVerifierInput => command !== undefined);
}

export function configuredVerifierCommandsFromTask(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return (commands as unknown[]).flatMap((command) => {
    if (isRecord(command)) {
      const name = command.name;
      const commandText = command.command;

      if (typeof name !== "string" || typeof commandText !== "string") {
        return [];
      }

      return [
        {
          name,
          command: commandText
        }
      ];
    }

    return [];
  });
}

function discoveredVerifierCommand(
  name: string,
  command: string | undefined
): CommandVerifierInput | undefined {
  return command === undefined ? undefined : { name, command };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
