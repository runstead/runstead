import type { Task } from "@runstead/core";

import { isCiRepairPullRequestResumeTask } from "./ci-repair-orchestrator.js";
import { LOCAL_AGENT_TASK_TYPE } from "./local-agent.js";
import { isRunnableCiRepairTask } from "./run-ci-repair-task.js";
import { listTasks } from "./tasks.js";

export const RUN_ONCE_SUPPORTED_TASK_TYPES = [
  "run_local_verifiers",
  LOCAL_AGENT_TASK_TYPE,
  "ci_repair",
  "manual_review"
];

const STARTUP_INTERNAL_TASK_TYPES = new Set([
  "generate_agent_context",
  "define_measurement_framework",
  "inspect_repo_readiness",
  "startup_remediation",
  "run_mvp_verifiers"
]);

export function pickNextQueuedTask(cwd = process.cwd()): Task | undefined {
  return listTasks({ cwd })
    .tasks.filter(
      (task) =>
        task.status === "queued" &&
        !isStartupInternalTask(task) &&
        (task.type !== "ci_repair" ||
          isCiRepairPullRequestResumeTask(task) ||
          isRunnableCiRepairTask(task))
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

function isStartupInternalTask(task: Task): boolean {
  return (
    task.domain === "ai-native-startup" && STARTUP_INTERNAL_TASK_TYPES.has(task.type)
  );
}
