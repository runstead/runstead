import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createRunsteadId } from "@runstead/core";

const execFileAsync = promisify(execFile);

export interface WorkspaceCheckpoint {
  id: string;
  workspace: string;
  checkpointDir: string;
  metadataPath: string;
  statusPath: string;
  patchPath: string;
  head?: string;
  createdAt: string;
}

export interface CreateWorkspaceCheckpointOptions {
  workspace: string;
  checkpointDir: string;
  now?: Date;
  runner?: GitCheckpointRunner;
}

export type GitCheckpointRunner = (
  args: string[],
  options: { cwd: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

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
  const runner = options.runner ?? runGit;
  const [head, status, patch] = await Promise.all([
    runner(["rev-parse", "HEAD"], { cwd: workspace }),
    runner(["status", "--short"], { cwd: workspace }),
    runner(["diff", "--binary", "HEAD"], { cwd: workspace })
  ]);
  const checkpoint: WorkspaceCheckpoint = {
    id,
    workspace,
    checkpointDir,
    metadataPath,
    statusPath,
    patchPath,
    ...(head.exitCode === 0 ? { head: head.stdout.trim() } : {}),
    createdAt
  };

  await mkdir(checkpointDir, { recursive: true });
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
          headStderr: head.stderr,
          statusStderr: status.stderr,
          diffStderr: patch.stderr
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return checkpoint;
}

async function runGit(
  args: string[],
  options: { cwd: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 20,
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
