import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { SkillPackageValidationResult } from "./validator.js";
import { validateSkillPackageDir } from "./validator.js";

const execFileAsync = promisify(execFile);

export interface SkillTestResult {
  root: string;
  validation: SkillPackageValidationResult;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  passed: boolean;
}

export async function runSkillPackageTests(root: string): Promise<SkillTestResult> {
  const resolvedRoot = resolve(root);
  const validation = await validateSkillPackageDir(resolvedRoot);
  const command = "sh";
  const args = [join(resolvedRoot, "tests", "run.sh")];
  const result = await runProcess(command, args, resolvedRoot);

  return {
    root: resolvedRoot,
    validation,
    command,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    passed: validation.valid && result.exitCode === 0
  };
}

export function formatSkillTestReport(result: SkillTestResult): string {
  return [
    `Skill package: ${result.root}`,
    `Validation: ${result.validation.valid ? "valid" : "invalid"}`,
    `Command: ${[result.command, ...result.args].join(" ")}`,
    `Exit code: ${result.exitCode}`,
    `Result: ${result.passed ? "passed" : "failed"}`,
    result.stdout.length === 0 ? "Stdout: <empty>" : `Stdout:\n${result.stdout}`,
    result.stderr.length === 0 ? "Stderr: <empty>" : `Stderr:\n${result.stderr}`
  ].join("\n");
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 1024 * 1024 * 10,
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
