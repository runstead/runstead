import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import type {
  CreateWorkspaceCheckpointOptions,
  ReadWorkspaceCheckpointOptions,
  RecordWorkspaceCheckpointCreatedEventOptions,
  RecordWorkspaceCheckpointRestoreEventOptions,
  RestoreWorkspaceCheckpointOptions,
  RestoreWorkspaceCheckpointResult,
  WorkspaceCheckpoint
} from "./checkpoints-types.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_CHECKPOINT_GIT_TIMEOUT_MS = 60_000;
export const DEFAULT_CHECKPOINT_GIT_MAX_OUTPUT_BYTES = 1024 * 1024 * 20;

export type {
  CreateWorkspaceCheckpointOptions,
  GitCheckpointRunner,
  ReadWorkspaceCheckpointOptions,
  RecordWorkspaceCheckpointCreatedEventOptions,
  RecordWorkspaceCheckpointRestoreEventOptions,
  RestoreWorkspaceCheckpointOptions,
  RestoreWorkspaceCheckpointResult,
  WorkspaceCheckpoint
} from "./checkpoints-types.js";

export async function createWorkspaceCheckpoint(
  options: CreateWorkspaceCheckpointOptions
): Promise<WorkspaceCheckpoint> {
  const workspace = resolve(options.workspace);
  const checkpointDir = resolve(options.checkpointDir);
  const createdAt = (options.now ?? new Date()).toISOString();
  const id = createRunsteadId("chk");
  const metadataPath = join(checkpointDir, `${id}.json`);
  const statusPath = join(checkpointDir, `${id}.status.txt`);
  const patchPath = join(checkpointDir, `${id}.patch`);
  const untrackedDir = join(checkpointDir, `${id}.untracked`);
  const runner = options.runner ?? runGit;
  const gitOptions = checkpointGitOptions(options);
  const [head, status, patch, untracked] = await Promise.all([
    runner(["rev-parse", "HEAD"], { cwd: workspace, ...gitOptions }),
    runner(["status", "--short"], { cwd: workspace, ...gitOptions }),
    runner(["diff", "--binary", "HEAD"], { cwd: workspace, ...gitOptions }),
    runner(["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: workspace,
      ...gitOptions
    })
  ]);
  const untrackedFiles =
    untracked.exitCode === 0
      ? parseNulPaths(untracked.stdout).filter(isCheckpointSnapshotPath)
      : [];
  const checkpoint: WorkspaceCheckpoint = {
    id,
    workspace,
    checkpointDir,
    metadataPath,
    statusPath,
    patchPath,
    untrackedDir,
    untrackedFiles,
    ...(head.exitCode === 0 ? { head: head.stdout.trim() } : {}),
    createdAt
  };

  await mkdir(checkpointDir, { recursive: true });
  await copyUntrackedSnapshot(workspace, untrackedDir, untrackedFiles);
  await writeFile(statusPath, status.stdout, "utf8");
  await writeFile(patchPath, patch.stdout, "utf8");
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        ...checkpoint,
        git: {
          headExitCode: head.exitCode,
          statusExitCode: status.exitCode,
          diffExitCode: patch.exitCode,
          untrackedExitCode: untracked.exitCode,
          headStderr: head.stderr,
          statusStderr: status.stderr,
          diffStderr: patch.stderr,
          untrackedStderr: untracked.stderr
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return checkpoint;
}

export async function readWorkspaceCheckpoint(
  options: ReadWorkspaceCheckpointOptions
): Promise<WorkspaceCheckpoint> {
  const workspace = resolve(options.workspace);
  const checkpointDir = resolve(options.checkpointDir);
  const metadataPath = join(checkpointDir, `${options.checkpointId}.json`);
  const raw = JSON.parse(await readFile(metadataPath, "utf8")) as Record<
    string,
    unknown
  >;
  const id = stringField(raw, "id", options.checkpointId);
  const statusPath = stringField(
    raw,
    "statusPath",
    join(checkpointDir, `${id}.status.txt`)
  );
  const patchPath = stringField(raw, "patchPath", join(checkpointDir, `${id}.patch`));
  const untrackedDir = stringField(
    raw,
    "untrackedDir",
    join(checkpointDir, `${id}.untracked`)
  );
  const head = optionalStringField(raw, "head");

  return {
    id,
    workspace,
    checkpointDir,
    metadataPath,
    statusPath,
    patchPath,
    untrackedDir,
    untrackedFiles: stringArrayField(raw, "untrackedFiles").filter(
      isCheckpointSnapshotPath
    ),
    ...(head === undefined ? {} : { head }),
    createdAt: stringField(raw, "createdAt", "")
  };
}

export async function restoreWorkspaceCheckpoint(
  options: RestoreWorkspaceCheckpointOptions
): Promise<RestoreWorkspaceCheckpointResult> {
  const workspace = resolve(options.workspace);
  const checkpoint = await readWorkspaceCheckpoint(options);
  const runner = options.runner ?? runGit;
  const gitOptions = checkpointGitOptions(options);

  if (checkpoint.head === undefined || checkpoint.head.length === 0) {
    throw new Error(`Checkpoint ${checkpoint.id} does not include a git HEAD`);
  }

  const currentHead = await runner(["rev-parse", "HEAD"], {
    cwd: workspace,
    ...gitOptions
  });
  if (currentHead.exitCode !== 0) {
    throw new Error(
      `git rev-parse HEAD failed with exit ${currentHead.exitCode}: ${currentHead.stderr}`
    );
  }

  const currentHeadSha = currentHead.stdout.trim();
  if (currentHeadSha !== checkpoint.head && options.allowHeadMismatch !== true) {
    throw new Error(
      `Checkpoint ${checkpoint.id} was created at ${checkpoint.head}, current HEAD is ${currentHeadSha}`
    );
  }

  const reset = await runner(["reset", "--hard", checkpoint.head], {
    cwd: workspace,
    ...gitOptions
  });
  if (reset.exitCode !== 0) {
    throw new Error(
      `git reset --hard failed with exit ${reset.exitCode}: ${reset.stderr}`
    );
  }

  const untracked = await runner(["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: workspace,
    ...gitOptions
  });
  if (untracked.exitCode !== 0) {
    throw new Error(
      `git ls-files --others failed with exit ${untracked.exitCode}: ${untracked.stderr}`
    );
  }

  const removedUntrackedFiles = parseNulPaths(untracked.stdout)
    .filter(isSafeRelativePath)
    .filter((path) => !isCheckpointExcludedPath(path));

  await Promise.all(
    removedUntrackedFiles.map((path) =>
      rm(join(workspace, path), { force: true, recursive: true })
    )
  );
  await copyUntrackedSnapshot(
    checkpoint.untrackedDir,
    workspace,
    checkpoint.untrackedFiles.filter(isCheckpointSnapshotPath)
  );

  const patch = await readFile(checkpoint.patchPath, "utf8");
  const restoredTrackedPatch = patch.trim().length > 0;

  if (restoredTrackedPatch) {
    const apply = await runner(["apply", "--whitespace=nowarn", checkpoint.patchPath], {
      cwd: workspace,
      ...gitOptions
    });
    if (apply.exitCode !== 0) {
      throw new Error(`git apply failed with exit ${apply.exitCode}: ${apply.stderr}`);
    }
  }

  return {
    checkpoint,
    currentHead: currentHeadSha,
    restoredTrackedPatch,
    restoredUntrackedFiles: checkpoint.untrackedFiles.filter(isCheckpointSnapshotPath),
    removedUntrackedFiles
  };
}

export function formatWorkspaceCheckpointRestoreReport(
  result: RestoreWorkspaceCheckpointResult
): string {
  return [
    `Checkpoint: ${result.checkpoint.id}`,
    `HEAD: ${result.currentHead ?? "unknown"} -> ${result.checkpoint.head ?? "unknown"}`,
    `Tracked patch restored: ${result.restoredTrackedPatch ? "yes" : "no"}`,
    `Untracked files restored: ${result.restoredUntrackedFiles.length}`,
    `Untracked files removed: ${result.removedUntrackedFiles.length}`
  ].join("\n");
}

export function recordWorkspaceCheckpointRestoreEvent(
  options: RecordWorkspaceCheckpointRestoreEventOptions
): RunsteadEvent {
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "checkpoint.restored",
    aggregateType: "checkpoint",
    aggregateId: options.result.checkpoint.id,
    payload: {
      workspace: options.result.checkpoint.workspace,
      checkpointId: options.result.checkpoint.id,
      currentHead: options.result.currentHead ?? "",
      restoredTrackedPatch: options.result.restoredTrackedPatch,
      restoredUntrackedFiles: options.result.restoredUntrackedFiles,
      removedUntrackedFiles: options.result.removedUntrackedFiles,
      ...(options.actor === undefined ? {} : { actor: options.actor })
    },
    createdAt: (options.now ?? new Date()).toISOString()
  };
  const database = openRunsteadDatabase(options.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return event;
}

export function recordWorkspaceCheckpointCreatedEvent(
  options: RecordWorkspaceCheckpointCreatedEventOptions
): RunsteadEvent {
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "checkpoint.created",
    aggregateType: "checkpoint",
    aggregateId: options.checkpoint.id,
    payload: {
      workspace: options.checkpoint.workspace,
      checkpointId: options.checkpoint.id,
      head: options.checkpoint.head ?? "",
      untrackedFiles: options.checkpoint.untrackedFiles,
      ...(options.actor === undefined ? {} : { actor: options.actor })
    },
    createdAt: (options.now ?? new Date()).toISOString()
  };
  const database = openRunsteadDatabase(options.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return event;
}

async function runGit(
  args: string[],
  options: { cwd: string; maxOutputBytes: number; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      maxBuffer: options.maxOutputBytes,
      timeout: options.timeoutMs,
      windowsHide: true
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: commandOutput(error, "stdout"),
      stderr: commandOutput(error, "stderr"),
      exitCode: commandExitCode(error)
    };
  }
}

function checkpointGitOptions(options: {
  gitMaxOutputBytes?: number;
  gitTimeoutMs?: number;
}): { maxOutputBytes: number; timeoutMs: number } {
  return {
    maxOutputBytes:
      options.gitMaxOutputBytes ?? DEFAULT_CHECKPOINT_GIT_MAX_OUTPUT_BYTES,
    timeoutMs: options.gitTimeoutMs ?? DEFAULT_CHECKPOINT_GIT_TIMEOUT_MS
  };
}

function commandExitCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }

  return 1;
}

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null) {
    const output = (error as Record<string, unknown>)[key];

    if (typeof output === "string") {
      return output;
    }
  }

  return "";
}

async function copyUntrackedSnapshot(
  sourceRoot: string,
  destinationRoot: string,
  files: string[]
): Promise<void> {
  await Promise.all(
    files.map(async (path) => {
      const source = join(sourceRoot, path);
      const destination = join(destinationRoot, path);

      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { force: true, recursive: true });
    })
  );
}

function parseNulPaths(stdout: string): string[] {
  return stdout
    .split("\0")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

function isSafeRelativePath(path: string): boolean {
  const normalized = normalize(path);

  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    normalized !== ".." &&
    !normalized.startsWith(`..${sep}`)
  );
}

function isCheckpointSnapshotPath(path: string): boolean {
  return isSafeRelativePath(path) && !isCheckpointExcludedPath(path);
}

function isCheckpointExcludedPath(path: string): boolean {
  const normalized = normalize(path);

  return (
    normalized === ".runstead" ||
    normalized.startsWith(`.runstead${sep}`) ||
    normalized === ".team" ||
    normalized.startsWith(`.team${sep}`) ||
    normalized === ".git" ||
    normalized.startsWith(`.git${sep}`) ||
    normalized === "node_modules" ||
    normalized.startsWith(`node_modules${sep}`)
  );
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  return typeof value[key] === "string" ? value[key] : fallback;
}

function optionalStringField(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const items = value[key];

  return Array.isArray(items)
    ? items.filter((item): item is string => typeof item === "string")
    : [];
}
