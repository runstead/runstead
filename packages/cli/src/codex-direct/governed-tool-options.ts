import type { WorkerRun } from "@runstead/core";

import type { CodexDirectWorkerOptions } from "./worker.js";

export function governedToolOptions(
  options: Pick<
    CodexDirectWorkerOptions,
    "cwd" | "stateDb" | "database" | "policy" | "task" | "now"
  > & { workerRun: WorkerRun }
) {
  return {
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    requestedBy: "runstead:codex-direct",
    ...(options.now === undefined ? {} : { now: options.now })
  };
}
