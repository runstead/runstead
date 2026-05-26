import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { JsonObject } from "@runstead/core";

import {
  runGovernedToolAction,
  type RunGovernedToolActionResult
} from "./governed-action.js";
import type {
  GovernedFilesystemOptions,
  GovernedFilesystemResult,
  GovernedWorkspaceFileRead,
  GovernedWorkspaceFileWrite,
  ReadGovernedWorkspaceFileOptions,
  WriteGovernedWorkspaceFileOptions
} from "./filesystem-proxy-types.js";
import {
  isSafeScaffoldWritePath,
  SCAFFOLD_WRITE_GRANT_VERSION,
  stableActionId,
  stableActionSignature,
  workspaceTarget
} from "./filesystem-proxy-paths.js";
import type { ActionContext, ActionEnvelope } from "./policy.js";

export type {
  GovernedFilesystemOptions,
  GovernedFilesystemResult,
  GovernedWorkspaceFileRead,
  GovernedWorkspaceFileWrite,
  ReadGovernedWorkspaceFileOptions,
  WriteGovernedWorkspaceFileOptions
} from "./filesystem-proxy-types.js";

export async function readGovernedWorkspaceFile(
  options: ReadGovernedWorkspaceFileOptions
): Promise<GovernedFilesystemResult<GovernedWorkspaceFileRead>> {
  const target = await workspaceTarget(options.cwd, options.path, {
    allowMissingDescendants: true
  });
  const result = await runGovernedToolAction({
    ...governedOptions(options),
    action: filesystemAction({
      actionType: "filesystem.read",
      cwd: options.cwd,
      path: target.relativePath
    }),
    run: async () => {
      const content = await readFile(target.absolutePath, "utf8");
      const value = {
        path: target.relativePath,
        content,
        bytes: Buffer.byteLength(content, "utf8")
      };

      return {
        value,
        output: filesystemOutput(value)
      };
    }
  });

  return filesystemResult(result);
}

export async function writeGovernedWorkspaceFile(
  options: WriteGovernedWorkspaceFileOptions
): Promise<GovernedFilesystemResult<GovernedWorkspaceFileWrite>> {
  const target = await workspaceTarget(options.cwd, options.path, {
    allowMissingDescendants: true
  });
  const result = await runGovernedToolAction({
    ...governedOptions(options),
    action: filesystemAction({
      actionType: "filesystem.write",
      cwd: options.cwd,
      path: target.relativePath,
      taskId: options.task.id
    }),
    run: async () => {
      if (options.createDirs === true) {
        await mkdir(dirname(target.absolutePath), { recursive: true });
      }

      await writeFile(target.absolutePath, options.content, "utf8");
      const value = {
        path: target.relativePath,
        bytes: Buffer.byteLength(options.content, "utf8")
      };

      return {
        value,
        output: filesystemOutput(value)
      };
    }
  });

  return filesystemResult(result);
}

function governedOptions(options: GovernedFilesystemOptions) {
  return {
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    requestedBy: options.requestedBy,
    ...(options.now === undefined ? {} : { now: options.now })
  };
}

function filesystemAction(input: {
  actionType: "filesystem.read" | "filesystem.write";
  cwd: string;
  path: string;
  taskId?: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId(input.actionType, [input.cwd, input.path]),
    actionType: input.actionType,
    resource: {
      type: "file",
      path: input.path
    },
    context: filesystemActionContext(input)
  };
}

function filesystemActionContext(input: {
  actionType: "filesystem.read" | "filesystem.write";
  cwd: string;
  path: string;
  taskId?: string;
}): ActionContext {
  const base: ActionContext = {
    cwd: input.cwd,
    filesTouched: [input.path],
    ...(input.actionType === "filesystem.write"
      ? { sideEffects: ["write_workspace"] }
      : {})
  };

  if (
    input.actionType !== "filesystem.write" ||
    input.taskId === undefined ||
    !isSafeScaffoldWritePath(input.path)
  ) {
    return base;
  }

  return {
    ...base,
    riskClass: "safe_scaffold_write",
    riskSummary:
      "task-scoped cwd scaffold file write; excludes dependency, secret, protected runtime, and Runstead state paths",
    canonicalSignature: stableActionSignature("filesystem.write.scaffold", [
      input.cwd,
      input.taskId,
      SCAFFOLD_WRITE_GRANT_VERSION
    ]),
    approvalGrant: {
      mode: "scoped_until_expiry",
      scope: `${SCAFFOLD_WRITE_GRANT_VERSION}:${input.taskId}`
    }
  };
}

function filesystemOutput(input: { path: string; bytes: number }): JsonObject {
  return {
    path: input.path,
    bytes: input.bytes
  };
}

function filesystemResult<T>(
  result: RunGovernedToolActionResult<T>
): GovernedFilesystemResult<T> {
  return {
    value: result.value,
    toolCall: result.toolCall,
    policyDecision: result.policyDecision
  };
}
