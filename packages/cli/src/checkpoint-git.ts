import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GitCheckpointRunner } from "./checkpoints-types.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_CHECKPOINT_GIT_TIMEOUT_MS = 60_000;
export const DEFAULT_CHECKPOINT_GIT_MAX_OUTPUT_BYTES = 1024 * 1024 * 20;

export const runCheckpointGit: GitCheckpointRunner = async (
  args,
  options
): ReturnType<GitCheckpointRunner> => {
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
};

export function checkpointGitOptions(options: {
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
