import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { matchesPolicyPathPattern } from "./policy.js";

const execFileAsync = promisify(execFile);

export interface GitDiffCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GitDiffRunner = (
  args: string[],
  options: { cwd: string; timeoutMs?: number }
) => Promise<GitDiffCommandResult>;

export interface VerifyGitDiffScopeOptions {
  cwd?: string;
  baseRef?: string;
  headRef?: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  timeoutMs?: number;
  runner?: GitDiffRunner;
}

export interface GitDiffScopeViolation {
  path: string;
  reason: "denied_path" | "outside_allowed_scope";
  pattern?: string;
}

export interface GitDiffScopeVerification {
  cwd: string;
  passed: boolean;
  changedFiles: string[];
  violations: GitDiffScopeViolation[];
}

export async function verifyGitDiffScope(
  options: VerifyGitDiffScopeOptions = {}
): Promise<GitDiffScopeVerification> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const result = await (options.runner ?? runGit)(
    diffNameOnlyArgs(options.baseRef, options.headRef),
    {
      cwd,
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_CLI_TIMEOUT_MS
    }
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `git diff --name-only failed with exit ${result.exitCode}: ${result.stderr}`
    );
  }

  const changedFiles = parseChangedFiles(result.stdout);
  const violations = changedFiles.flatMap((path) =>
    diffScopeViolations(path, options.allowedPaths ?? [], options.deniedPaths ?? [])
  );

  return {
    cwd,
    passed: violations.length === 0,
    changedFiles,
    violations
  };
}

export function formatGitDiffScopeReport(result: GitDiffScopeVerification): string {
  return [
    "Git diff scope verifier",
    `Status: ${result.passed ? "passed" : "failed"}`,
    `Changed files: ${result.changedFiles.length}`,
    ...(result.violations.length === 0
      ? []
      : [
          "Violations:",
          ...result.violations.map((violation) =>
            [
              `  ${violation.reason}: ${violation.path}`,
              violation.pattern === undefined
                ? undefined
                : `pattern=${violation.pattern}`
            ]
              .filter((part): part is string => part !== undefined)
              .join(" ")
          )
        ])
  ].join("\n");
}

function diffNameOnlyArgs(
  baseRef: string | undefined,
  headRef: string | undefined
): string[] {
  const range = baseRef === undefined ? undefined : `${baseRef}...${headRef ?? "HEAD"}`;

  return ["diff", "--name-only", ...(range === undefined ? [] : [range])];
}

function parseChangedFiles(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function diffScopeViolations(
  path: string,
  allowedPaths: string[],
  deniedPaths: string[]
): GitDiffScopeViolation[] {
  const deniedPattern = deniedPaths.find((pattern) =>
    matchesPolicyPathPattern(path, pattern)
  );

  if (deniedPattern !== undefined) {
    return [
      {
        path,
        reason: "denied_path",
        pattern: deniedPattern
      }
    ];
  }

  if (
    allowedPaths.length > 0 &&
    !allowedPaths.some((pattern) => matchesPolicyPathPattern(path, pattern))
  ) {
    return [
      {
        path,
        reason: "outside_allowed_scope"
      }
    ];
  }

  return [];
}

async function runGit(
  args: string[],
  options: { cwd: string; timeoutMs?: number }
): Promise<GitDiffCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? DEFAULT_GIT_CLI_TIMEOUT_MS,
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

const DEFAULT_GIT_CLI_TIMEOUT_MS = 60_000;

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
