import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type {
  JsonObject,
  PolicyDecisionRecord,
  Task,
  ToolCall,
  WorkerRun
} from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  runGovernedToolAction,
  type RunGovernedToolActionResult
} from "./governed-action.js";
import type { ActionEnvelope, PolicyProfile } from "./policy.js";

export interface GovernedFilesystemOptions {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  requestedBy: string;
  now?: Date;
}

export interface ReadGovernedWorkspaceFileOptions extends GovernedFilesystemOptions {
  path: string;
}

export interface WriteGovernedWorkspaceFileOptions extends GovernedFilesystemOptions {
  path: string;
  content: string;
  createDirs?: boolean;
}

export interface GovernedWorkspaceFileRead {
  path: string;
  content: string;
  bytes: number;
}

export interface GovernedWorkspaceFileWrite {
  path: string;
  bytes: number;
}

export interface GovernedFilesystemResult<T> {
  value: T;
  toolCall: ToolCall;
  policyDecision: PolicyDecisionRecord;
}

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
      path: target.relativePath
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
}): ActionEnvelope {
  return {
    actionId: stableActionId(input.actionType, [input.cwd, input.path]),
    actionType: input.actionType,
    resource: {
      type: "file",
      path: input.path
    },
    context: {
      cwd: input.cwd
    }
  };
}

async function workspaceTarget(
  cwd: string,
  requestedPath: string,
  options: { allowMissingDescendants?: boolean } = {}
): Promise<{ absolutePath: string; relativePath: string }> {
  const root = resolve(cwd);
  const absolutePath = resolve(root, requestedPath);
  const relativePath = relative(root, absolutePath);

  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Workspace path escapes root: ${requestedPath}`);
  }

  await assertNoWorkspaceSymlinkTraversal(root, relativePath, requestedPath, options);

  return {
    absolutePath,
    relativePath: relativePath.split(sep).join("/")
  };
}

async function assertNoWorkspaceSymlinkTraversal(
  root: string,
  relativePath: string,
  requestedPath: string,
  options: { allowMissingDescendants?: boolean }
): Promise<void> {
  const realRoot = await realpath(root);
  const segments = relativePath.split(sep);
  let current = realRoot;

  for (const segment of segments) {
    current = resolve(current, segment);

    try {
      const stats = await lstat(current);

      if (stats.isSymbolicLink()) {
        throw new Error(`Workspace path crosses symlink: ${requestedPath}`);
      }
    } catch (error) {
      if (
        options.allowMissingDescendants === true &&
        isNodeErrorCode(error, "ENOENT")
      ) {
        return;
      }

      throw error;
    }
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
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

function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix.replaceAll(".", "_")}_${hash}`;
}
