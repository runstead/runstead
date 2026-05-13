import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

export interface ShellCommandInput {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface ShellCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

export function runShellCommand(input: ShellCommandInput): Promise<ShellCommandResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const startedAt = performance.now();

  return new Promise((resolveResult, reject) => {
    const child = spawn(input.command, {
      cwd,
      env: {
        ...process.env,
        ...input.env
      },
      shell: true,
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolveResult({
        command: input.command,
        cwd,
        exitCode,
        signal,
        durationMs: Math.round(performance.now() - startedAt)
      });
    });
  });
}
