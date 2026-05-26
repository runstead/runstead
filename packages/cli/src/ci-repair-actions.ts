import { createHash } from "node:crypto";

import type { Task } from "@runstead/core";

import type { ActionEnvelope } from "./policy.js";

export function githubRunReadAction(input: {
  task: Task;
  cwd: string;
  runId: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("github_run_read", [input.task.id, input.runId]),
    actionType: "github.run.read",
    resource: {
      type: "workflow_run",
      id: input.runId
    },
    context: {
      cwd: input.cwd,
      networkDomains: ["github.com"]
    }
  };
}

export function githubRunLogReadAction(input: {
  task: Task;
  cwd: string;
  runId: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("github_run_log_read", [input.task.id, input.runId]),
    actionType: "github.run.log.read",
    resource: {
      type: "workflow_run",
      id: input.runId
    },
    context: {
      cwd: input.cwd,
      networkDomains: ["github.com"]
    }
  };
}

function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix}_${hash}`;
}
