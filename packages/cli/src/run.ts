import { resolve } from "node:path";

import type { Task } from "@runstead/core";

import { listTasks } from "./tasks.js";

export interface RunOnceOptions {
  cwd?: string;
}

export type RunOnceResult = RunOnceNoTaskResult | RunOnceSelectedTaskResult;

export interface RunOnceNoTaskResult {
  cwd: string;
  ranTask: false;
  reason: "no_queued_task";
}

export interface RunOnceSelectedTaskResult {
  cwd: string;
  ranTask: false;
  reason: "task_selected";
  task: Task;
}

export function runOnce(options: RunOnceOptions = {}): RunOnceResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const task = pickNextQueuedTask(cwd);

  if (task !== undefined) {
    return {
      cwd,
      ranTask: false,
      reason: "task_selected",
      task
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
