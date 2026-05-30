import { resolve } from "node:path";

import type { Task } from "@runstead/core";

import { isCiRepairPullRequestResumeTask } from "./ci-repair-orchestrator.js";
import { isGenericDomainTask, runGenericDomainTask } from "./domain-task-execution.js";
import { isLocalAgentTask, runLocalAgentTask } from "./local-agent.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import {
  runCiRepairPullRequestResumeTask,
  runRunnableCiRepairTask
} from "./run-ci-repair-execution.js";
import { isRunnableCiRepairTask } from "./run-ci-repair-task.js";
import {
  pickNextQueuedTask,
  RUN_ONCE_SUPPORTED_TASK_TYPES
} from "./run-task-picker.js";
import { blockTask } from "./tasks.js";
import { runTaskVerifiersUnlocked } from "./verifier-runner.js";
import type { RunOnceOptions, RunOnceResult } from "./run-types.js";

export { formatRunOnceReport, runOnceExitCode } from "./run-report.js";
export { pickNextQueuedTask } from "./run-task-picker.js";
export type {
  RunOnceExecutedTaskResult,
  RunOnceNoTaskResult,
  RunOnceOptions,
  RunOnceResult
} from "./run-types.js";

export async function runOnce(options: RunOnceOptions = {}): Promise<RunOnceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());

  return withRunsteadManagerLock({ cwd }, async () => runOnceUnlocked(cwd, options));
}

export async function runOnceUnlocked(
  cwd: string,
  options: RunOnceOptions
): Promise<RunOnceResult> {
  const task = pickNextQueuedTask(cwd);

  if (task === undefined) {
    return {
      cwd,
      ranTask: false,
      reason: "no_queued_task"
    };
  }

  return runQueuedTaskUnlocked(cwd, task, options);
}

export async function runQueuedTaskUnlocked(
  cwd: string,
  task: Task,
  options: RunOnceOptions
): Promise<RunOnceResult> {
  if (task.type === "run_local_verifiers") {
    const result = await runTaskVerifiersUnlocked({
      cwd,
      taskId: task.id,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: result.task,
      commandResults: result.commandResults
    };
  }

  if (isLocalAgentTask(task)) {
    const result = await runLocalAgentTask({
      cwd,
      taskId: task.id,
      ...(options.codexDirectTransport === undefined
        ? {}
        : { transport: options.codexDirectTransport }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: result.task,
      localAgentResult: result
    };
  }

  if (isCiRepairPullRequestResumeTask(task)) {
    return runCiRepairPullRequestResumeTask({ cwd, task, options });
  }

  if (isRunnableCiRepairTask(task)) {
    return runRunnableCiRepairTask({ cwd, task, options });
  }

  if (isGenericDomainTask(task)) {
    const result = await runGenericDomainTask({ cwd, task, options });

    if (result.localAgentResult !== undefined) {
      return {
        cwd,
        ranTask: true,
        task: result.task,
        localAgentResult: result.localAgentResult
      };
    }

    if (result.commandResults !== undefined) {
      return {
        cwd,
        ranTask: true,
        task: result.task,
        commandResults: result.commandResults
      };
    }

    return {
      cwd,
      ranTask: true,
      task: result.task
    };
  }

  if (task.type === "manual_review") {
    const blocked = blockTask({
      cwd,
      task,
      reason: "manual_review_required",
      output: {
        summary:
          "Manual review tasks require a human evidence attachment before automation can continue.",
        verifiers: task.verifiers
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: blocked.task
    };
  }

  const blocked = blockTask({
    cwd,
    task,
    reason: "unsupported_task_type",
    output: {
      supportedTaskTypes: RUN_ONCE_SUPPORTED_TASK_TYPES
    },
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    cwd,
    ranTask: true,
    task: blocked.task
  };
}
