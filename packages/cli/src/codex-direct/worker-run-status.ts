import type { WorkerRun } from "@runstead/core";

import type { CodexDirectWorkerResult } from "./worker-types.js";

export function workerRunStatus(
  status: CodexDirectWorkerResult["status"]
): Exclude<WorkerRun["status"], "running"> {
  switch (status) {
    case "completed":
      return "completed";
    case "waiting_approval":
      return "waiting_approval";
    case "interrupted":
      return "interrupted";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
  }
}
