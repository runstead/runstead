import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

export interface ShellCommandInput {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface ShellCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
}

export function runShellCommand(input: ShellCommandInput): Promise<ShellCommandResult> {
  if (input.timeoutMs !== undefined && input.timeoutMs <= 0) {
    return Promise.reject(new Error("timeoutMs must be greater than 0"));
  }

  const cwd = resolve(input.cwd ?? process.cwd());
  const startedAt = performance.now();

  return new Promise((resolveResult, reject) => {
    let timedOut = false;
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
    const timeout =
      input.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, input.timeoutMs);

    timeout?.unref();

    child.once("error", (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      resolveResult({
        command: input.command,
        cwd,
        exitCode,
        signal,
        durationMs: Math.round(performance.now() - startedAt),
        timedOut
      });
    });
  });
}
