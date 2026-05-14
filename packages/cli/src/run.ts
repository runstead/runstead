import { resolve } from "node:path";

import type { Task } from "@runstead/core";

import { withRunsteadManagerLock } from "./manager-lock.js";
import { listTasks } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
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

  return withRunsteadManagerLock({ cwd }, async () => runOnceUnlocked(cwd));
}

async function runOnceUnlocked(cwd: string): Promise<RunOnceResult> {
  const task = pickNextQueuedTask(cwd);

  if (task !== undefined) {
    const result = await runTaskVerifiersUnlocked({
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
    .tasks.filter(
      (task) => task.status === "queued" && task.type === "run_local_verifiers"
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

export function formatRunOnceReport(result: RunOnceResult): string {
  if (!result.ranTask) {
    return ["Runstead run --once", "Status: idle", "Reason: no queued task"].join("\n");
  }

  return [
    "Runstead run --once",
    `Task: ${result.task.id}`,
    `Type: ${result.task.type}`,
    `Status: ${result.task.status}`,
    "Verifiers:",
    ...result.commandResults.map(
      (command) =>
        `  ${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
    )
  ].join("\n");
}

export function runOnceExitCode(result: RunOnceResult): number {
  return result.ranTask &&
    (result.task.status === "failed" ||
      result.task.status === "blocked" ||
      result.task.status === "waiting_approval")
    ? 1
    : 0;
}
