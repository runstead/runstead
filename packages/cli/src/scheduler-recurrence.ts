import type { Goal, JsonObject, Task } from "@runstead/core";

export function recurringTaskTypes(goal: Goal): string[] {
  const recurringTasks = goal.scope.recurringTasks;

  if (!Array.isArray(recurringTasks)) {
    return [];
  }

  return recurringTasks.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
}

export function recurringTaskIntervalMs(
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

export function dueAtForTask(
  task: Task | undefined,
  intervalMs: number,
  now: Date
): string {
  if (task === undefined) {
    return now.toISOString();
  }

  const createdAtMs = Date.parse(task.createdAt);

  if (!Number.isFinite(createdAtMs)) {
    return now.toISOString();
  }

  return new Date(createdAtMs + intervalMs).toISOString();
}

export function compareTasksNewestFirst(left: Task, right: Task): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function repositoryPathForGoal(goal: Goal, cwd: string): string {
  const repositoryPath = goal.scope.repositoryPath;

  return typeof repositoryPath === "string" ? repositoryPath : cwd;
}

export function assertPositiveInterval(intervalMs: number): void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Scheduler interval must be a positive number");
  }
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
