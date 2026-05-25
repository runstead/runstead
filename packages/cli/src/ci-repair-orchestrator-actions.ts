import { createHash } from "node:crypto";

import type { Task } from "@runstead/core";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import { CODEX_DIRECT_WORKER_KIND } from "./codex-direct-worker.js";
import type { CiRepairWorkerKind } from "./ci-repair-orchestrator-types.js";
import type { ActionEnvelope } from "./policy.js";

export function gitBranchCreateAction(input: {
  task: Task;
  cwd: string;
  branchName: string;
  base: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("git_branch_create", [
      input.task.id,
      input.branchName,
      input.base
    ]),
    actionType: "git.branch.create",
    resource: {
      type: "branch",
      id: input.branchName
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function gitStatusAction(input: { task: Task; cwd: string }): ActionEnvelope {
  return {
    actionId: stableActionId("git_status", [input.task.id]),
    actionType: "git.status",
    resource: {
      type: "repository",
      path: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function gitCommitAction(input: {
  task: Task;
  cwd: string;
  changedFiles: string[];
}): ActionEnvelope {
  return {
    actionId: stableActionId("git_commit", [input.task.id, ...input.changedFiles]),
    actionType: "git.commit",
    resource: {
      type: "repository",
      path: input.cwd
    },
    context: {
      cwd: input.cwd,
      filesTouched: input.changedFiles
    }
  };
}

export function checkpointCreateAction(input: {
  task: Task;
  cwd: string;
  checkpointDir: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("checkpoint_create", [input.task.id, input.checkpointDir]),
    actionType: "checkpoint.create",
    resource: {
      type: "repository",
      path: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function checkpointRestoreAction(input: {
  task: Task;
  cwd: string;
  checkpoint: WorkspaceCheckpoint;
}): ActionEnvelope {
  return {
    actionId: stableActionId("checkpoint_restore", [
      input.task.id,
      input.checkpoint.id
    ]),
    actionType: "checkpoint.restore",
    resource: {
      type: "repository",
      path: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function workerStartAction(input: {
  task: Task;
  cwd: string;
  worker: CiRepairWorkerKind;
}): ActionEnvelope {
  const nativeWorker = input.worker === CODEX_DIRECT_WORKER_KIND;

  return {
    actionId: stableActionId(
      nativeWorker ? "worker_native_start" : "worker_external_start",
      [input.task.id, input.worker]
    ),
    actionType: nativeWorker ? "worker.native.start" : "worker.external.start",
    resource: {
      type: "process",
      id: input.worker
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function gitDiffAction(input: {
  task: Task;
  cwd: string;
  base: string;
  head: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("git_diff", [input.task.id, input.base, input.head]),
    actionType: "git.diff",
    resource: {
      type: "repository",
      path: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function gitPushAction(input: {
  task: Task;
  actionId: string;
  branchName: string;
  base: string;
}): ActionEnvelope {
  return {
    actionId: input.actionId,
    actionType: "git.push",
    resource: {
      type: "branch",
      id: input.branchName
    },
    context: {
      networkDomains: ["github.com"],
      sideEffects: ["git_push"]
    }
  };
}

export function repairPublishAction(input: {
  actionId: string;
  branchName: string;
  base: string;
  draft: boolean;
}): ActionEnvelope {
  return {
    actionId: input.actionId,
    actionType: "repo.publish_repair",
    resource: {
      type: "pull_request",
      id: `${input.base}...${input.branchName}${input.draft ? ":draft" : ""}`
    },
    context: {
      filesTouched: [],
      sideEffects: ["git_push", "github_pr_create"],
      networkDomains: ["github.com"]
    }
  };
}

export function githubPullRequestCreateAction(input: {
  task: Task;
  actionId: string;
  title: string;
  base: string;
  head: string;
}): ActionEnvelope {
  return {
    actionId: input.actionId,
    actionType: "github.pr.create",
    resource: {
      type: "pull_request",
      id: `${input.base}...${input.head}`
    },
    context: {
      filesTouched: [],
      networkDomains: ["github.com"],
      sideEffects: ["github_pr_create"]
    }
  };
}

export function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 16);

  return `${prefix}_${hash}`;
}
