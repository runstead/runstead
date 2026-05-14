import { resolve } from "node:path";

import {
  type Goal,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { listGoals } from "./goals.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { buildRunLocalVerifiersTask, listTasks } from "./tasks.js";

export const DEFAULT_SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ScheduleDueTasksOptions {
  cwd?: string;
  now?: Date;
  defaultIntervalMs?: number;
}

export interface ScheduledTaskResult {
  goalId: string;
  type: string;
  task: Task;
  event: RunsteadEvent;
  dueAt: string;
  intervalMs: number;
}

export interface SkippedScheduledTask {
  goalId: string;
  type: string;
  reason: "active_task_exists" | "not_due" | "unsupported_task_type";
  dueAt?: string;
  intervalMs?: number;
  taskId?: string;
}

export interface ScheduleDueTasksResult {
  cwd: string;
  stateDb: string;
  scheduledTasks: ScheduledTaskResult[];
  skippedTasks: SkippedScheduledTask[];
}

const ACTIVE_TASK_STATUSES = new Set([
  "queued",
  "claimed",
  "running",
  "waiting_approval",
  "blocked"
]);

export async function scheduleDueTasks(
  options: ScheduleDueTasksOptions = {}
): Promise<ScheduleDueTasksResult> {
  const cwd = resolve(options.cwd ?? process.cwd());

  return withRunsteadManagerLock({ cwd }, async () =>
    scheduleDueTasksUnlocked({
      ...options,
      cwd
    })
  );
}

export async function scheduleDueTasksUnlocked(
  options: ScheduleDueTasksOptions
): Promise<ScheduleDueTasksResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stateDb = requireRunsteadStateDbSync(cwd).stateDb;
  const now = options.now ?? new Date();
  const defaultIntervalMs = options.defaultIntervalMs ?? DEFAULT_SCHEDULER_INTERVAL_MS;

  assertPositiveInterval(defaultIntervalMs);

  const goals = listGoals({ cwd }).goals.filter((goal) => goal.status === "active");
  const scheduledTasks: ScheduledTaskResult[] = [];
  const skippedTasks: SkippedScheduledTask[] = [];

  for (const goal of goals) {
    const recurringTasks = recurringTaskTypes(goal);

    for (const type of recurringTasks) {
      const existingTasks = listTasks({ cwd, goalId: goal.id })
        .tasks.filter((task) => task.type === type)
        .sort(compareTasksNewestFirst);
      const activeTask = existingTasks.find((task) =>
        ACTIVE_TASK_STATUSES.has(task.status)
      );
      const intervalMs = recurringTaskIntervalMs(goal, type, defaultIntervalMs);
      const lastTask = existingTasks[0];
      const dueAt = dueAtForTask(lastTask, intervalMs, now);

      if (activeTask !== undefined) {
        skippedTasks.push({
          goalId: goal.id,
          type,
          reason: "active_task_exists",
          dueAt,
          intervalMs,
          taskId: activeTask.id
        });
        continue;
      }

      if (Date.parse(dueAt) > now.getTime()) {
        skippedTasks.push({
          goalId: goal.id,
          type,
          reason: "not_due",
          dueAt,
          intervalMs,
          ...(lastTask === undefined ? {} : { taskId: lastTask.id })
        });
        continue;
      }

      if (type !== "run_local_verifiers") {
        skippedTasks.push({
          goalId: goal.id,
          type,
          reason: "unsupported_task_type",
          dueAt,
          intervalMs
        });
        continue;
      }

      const scheduled = await scheduleRunLocalVerifiersTask({
        cwd,
        stateDb,
        goal,
        now,
        dueAt,
        intervalMs,
        ...(lastTask === undefined ? {} : { lastTask })
      });

      scheduledTasks.push(scheduled);
    }
  }

  return {
    cwd,
    stateDb,
    scheduledTasks,
    skippedTasks
  };
}

export function formatSchedulerReport(result: ScheduleDueTasksResult): string {
  return [
    "Runstead scheduler",
    `Cwd: ${result.cwd}`,
    `Scheduled tasks: ${result.scheduledTasks.length}`,
    `Skipped recurrences: ${result.skippedTasks.length}`,
    ...result.scheduledTasks.map(
      (item) =>
        `  scheduled ${item.goalId} ${item.type} -> ${item.task.id} due=${item.dueAt}`
    ),
    ...result.skippedTasks.map((item) =>
      [
        `  skipped ${item.goalId} ${item.type}`,
        `reason=${item.reason}`,
        item.dueAt === undefined ? undefined : `due=${item.dueAt}`,
        item.taskId === undefined ? undefined : `task=${item.taskId}`
      ]
        .filter((part) => part !== undefined)
        .join(" ")
    )
  ].join("\n");
}

async function scheduleRunLocalVerifiersTask(input: {
  cwd: string;
  stateDb: string;
  goal: Goal;
  now: Date;
  dueAt: string;
  intervalMs: number;
  lastTask?: Task;
}): Promise<ScheduledTaskResult> {
  const scheduledAt = input.now.toISOString();
  const repositoryPath = repositoryPathForGoal(input.goal, input.cwd);
  const generated = await buildRunLocalVerifiersTask({
    cwd: repositoryPath,
    goal: input.goal,
    now: input.now
  });
  const task: Task = {
    ...generated.task,
    input: {
      ...generated.task.input,
      schedule: {
        source: "background_scheduler",
        recurrenceType: generated.task.type,
        dueAt: input.dueAt,
        intervalMs: input.intervalMs,
        scheduledAt,
        ...(input.lastTask === undefined
          ? {}
          : {
              lastTaskId: input.lastTask.id,
              lastTaskStatus: input.lastTask.status
            })
      }
    }
  };
  const event: RunsteadEvent = {
    ...generated.event,
    type: "task.scheduled",
    payload: {
      goalId: task.goalId,
      type: task.type,
      source: "background_scheduler",
      dueAt: input.dueAt,
      intervalMs: input.intervalMs,
      ...(input.lastTask === undefined
        ? {}
        : {
            lastTaskId: input.lastTask.id,
            lastTaskStatus: input.lastTask.status
          })
    },
    createdAt: scheduledAt
  };
  const database = openRunsteadDatabase(input.stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }

  return {
    goalId: input.goal.id,
    type: task.type,
    task,
    event,
    dueAt: input.dueAt,
    intervalMs: input.intervalMs
  };
}

function recurringTaskTypes(goal: Goal): string[] {
  const recurringTasks = goal.scope.recurringTasks;

  if (!Array.isArray(recurringTasks)) {
    return [];
  }

  return recurringTasks.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
}

function recurringTaskIntervalMs(
  goal: Goal,
  taskType: string,
  defaultIntervalMs: number
): number {
  const intervalMs =
    readPositiveNumber(goal.scope, ["scheduler", "tasks", taskType, "intervalMs"]) ??
    readPositiveNumber(goal.scope, ["scheduler", "intervalMs"]) ??
    readPositiveNumber(goal.scope, ["schedule", "intervalMs"]) ??
    readPositiveNumber(goal.scope, ["scheduleIntervalMs"]) ??
    readPositiveMinutes(goal.scope, [
      "scheduler",
      "tasks",
      taskType,
      "intervalMinutes"
    ]) ??
    readPositiveMinutes(goal.scope, ["scheduler", "intervalMinutes"]) ??
    readPositiveMinutes(goal.scope, ["schedule", "intervalMinutes"]) ??
    readPositiveMinutes(goal.scope, ["scheduleIntervalMinutes"]) ??
    defaultIntervalMs;

  assertPositiveInterval(intervalMs);

  return intervalMs;
}

function readPositiveMinutes(
  source: JsonObject,
  path: readonly string[]
): number | undefined {
  const minutes = readPositiveNumber(source, path);

  return minutes === undefined ? undefined : minutes * 60_000;
}

function readPositiveNumber(
  source: JsonObject,
  path: readonly string[]
): number | undefined {
  let current: unknown = source;

  for (const segment of path) {
    if (!isJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "number" && current > 0 && Number.isFinite(current)
    ? current
    : undefined;
}

function dueAtForTask(task: Task | undefined, intervalMs: number, now: Date): string {
  if (task === undefined) {
    return now.toISOString();
  }

  const createdAtMs = Date.parse(task.createdAt);

  if (!Number.isFinite(createdAtMs)) {
    return now.toISOString();
  }

  return new Date(createdAtMs + intervalMs).toISOString();
}

function compareTasksNewestFirst(left: Task, right: Task): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function repositoryPathForGoal(goal: Goal, cwd: string): string {
  const repositoryPath = goal.scope.repositoryPath;

  return typeof repositoryPath === "string" ? repositoryPath : cwd;
}

function assertPositiveInterval(intervalMs: number): void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Scheduler interval must be a positive number");
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
