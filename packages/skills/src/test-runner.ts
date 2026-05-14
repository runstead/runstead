import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { SkillPackageValidationResult } from "./validator.js";
import { validateSkillPackageDir } from "./validator.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_SKILL_TEST_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_SKILL_TEST_MAX_OUTPUT_BYTES = 1024 * 1024 * 10;

export interface RunSkillPackageTestsOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface SkillTestResult {
  root: string;
  validation: SkillPackageValidationResult;
  command: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  passed: boolean;
}

export async function runSkillPackageTests(
  root: string,
  options: RunSkillPackageTestsOptions = {}
): Promise<SkillTestResult> {
  const resolvedRoot = resolve(root);
  const validation = await validateSkillPackageDir(resolvedRoot);
  const command = "sh";
  const args = [join(resolvedRoot, "tests", "run.sh")];
  const timeoutMs = options.timeoutMs ?? DEFAULT_SKILL_TEST_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_SKILL_TEST_MAX_OUTPUT_BYTES;
  const result = await runProcess(command, args, resolvedRoot, {
    maxOutputBytes,
    timeoutMs
  });

  return {
    root: resolvedRoot,
    validation,
    command,
    args,
    timeoutMs,
    maxOutputBytes,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    passed: validation.valid && result.exitCode === 0 && !result.timedOut
  };
}

export function formatSkillTestReport(result: SkillTestResult): string {
  return [
    `Skill package: ${result.root}`,
    `Validation: ${result.validation.valid ? "valid" : "invalid"}`,
    `Command: ${[result.command, ...result.args].join(" ")}`,
    `Timeout: ${result.timeoutMs}ms`,
    `Max output: ${result.maxOutputBytes} bytes`,
    `Exit code: ${result.exitCode}`,
    `Timed out: ${result.timedOut ? "yes" : "no"}`,
    `Result: ${result.passed ? "passed" : "failed"}`,
    result.stdout.length === 0 ? "Stdout: <empty>" : `Stdout:\n${result.stdout}`,
    result.stderr.length === 0 ? "Stderr: <empty>" : `Stderr:\n${result.stderr}`
  ].join("\n");
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  options: { maxOutputBytes: number; timeoutMs: number }
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      maxBuffer: options.maxOutputBytes,
      timeout: options.timeoutMs,
      windowsHide: true
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      timedOut: false
    };
  } catch (error) {
    return {
      stdout: commandOutput(error, "stdout"),
      stderr: commandOutput(error, "stderr"),
      exitCode: commandExitCode(error),
      timedOut: commandTimedOut(error)
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

function commandTimedOut(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const record = error as Record<string, unknown>;

  return record.killed === true && record.signal === "SIGTERM";
}
