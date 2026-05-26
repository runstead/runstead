import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

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
import type { ActionContext, ActionEnvelope } from "./policy.js";

const SCAFFOLD_WRITE_GRANT_VERSION = "safe_cwd_scaffold_write_v1";
const DEPENDENCY_FILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "requirements.txt",
  "poetry.lock",
  "uv.lock",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock"
]);
const UNSAFE_SCAFFOLD_PREFIXES = [
  ".git/",
  ".runstead/",
  "node_modules/",
  "dist/",
  "build/"
];

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

function isSafeScaffoldWritePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments.at(-1);

  if (segments.length === 0 || fileName === undefined) {
    return false;
  }

  if (
    DEPENDENCY_FILE_NAMES.has(fileName) ||
    isEnvFileName(fileName) ||
    UNSAFE_SCAFFOLD_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    segments.some((segment) => segment === "secrets" || segment === ".runstead")
  ) {
    return false;
  }

  return true;
}

function isEnvFileName(fileName: string): boolean {
  return fileName === ".env" || fileName.startsWith(".env.");
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

function stableActionSignature(prefix: string, parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify([prefix, ...parts]))
    .digest("hex");
}
