import type { Task } from "@runstead/core";

import { listTasks } from "./tasks.js";

export interface InterruptedTask {
  task: Task;
  reason: "claimed_or_running";
}

export interface FindInterruptedTasksOptions {
  cwd?: string;
}

export interface FindInterruptedTasksResult {
  interruptedTasks: InterruptedTask[];
  stateDb: string;
}

const INTERRUPTED_STATUSES = new Set<Task["status"]>(["claimed", "running"]);

export function findInterruptedTasks(
  options: FindInterruptedTasksOptions = {}
): FindInterruptedTasksResult {
  const tasks = listTasks(options);

  return {
    interruptedTasks: tasks.tasks
      .filter((task) => INTERRUPTED_STATUSES.has(task.status))
      .map((task) => ({
        task,
        reason: "claimed_or_running"
      })),
    stateDb: tasks.stateDb
  };
}
