import { resolve } from "node:path";

import type { Task } from "@runstead/core";

import { listTasks } from "./tasks.js";
import {
  runTaskVerifiers,
  type RunTaskVerifierCommandResult
} from "./verifier-runner.js";

export interface RunOnceOptions {
  cwd?: string;
}

export type RunOnceResult = RunOnceNoTaskResult | RunOnceExecutedTaskResult;

export interface RunOnceNoTaskResult {
  cwd: string;
  ranTask: false;
  reason: "no_queued_task";
}

export interface RunOnceExecutedTaskResult {
  cwd: string;
  ranTask: true;
  task: Task;
  commandResults: RunTaskVerifierCommandResult[];
}

export async function runOnce(options: RunOnceOptions = {}): Promise<RunOnceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const task = pickNextQueuedTask(cwd);

  if (task !== undefined) {
    const result = await runTaskVerifiers({
      cwd,
      taskId: task.id
    });

    return {
      cwd,
      ranTask: true,
      task: result.task,
      commandResults: result.commandResults
    };
  }

  return {
    cwd,
    ranTask: false,
    reason: "no_queued_task"
  };
}

export function pickNextQueuedTask(cwd = process.cwd()): Task | undefined {
  return listTasks({ cwd })
    .tasks.filter((task) => task.status === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}
