import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

export interface ShellCommandInput {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
  redactValues?: string[];
}

export interface ShellCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  forceKilled: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 1_000;

export function runShellCommand(input: ShellCommandInput): Promise<ShellCommandResult> {
  if (input.timeoutMs !== undefined && input.timeoutMs <= 0) {
    return Promise.reject(new Error("timeoutMs must be greater than 0"));
  }

  if (input.maxOutputBytes !== undefined && input.maxOutputBytes <= 0) {
    return Promise.reject(new Error("maxOutputBytes must be greater than 0"));
  }

  if (input.killGraceMs !== undefined && input.killGraceMs <= 0) {
    return Promise.reject(new Error("killGraceMs must be greater than 0"));
  }

  const cwd = resolve(input.cwd ?? process.cwd());
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const killGraceMs = input.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const env = {
    ...process.env,
    ...input.env
  };
  const redactionValues = collectRedactionValues(env, input.redactValues ?? []);
  const startedAt = performance.now();

  return new Promise((resolveResult, reject) => {
    let timedOut = false;
    let forceKilled = false;
    let pendingClose:
      | {
          exitCode: number | null;
          signal: NodeJS.Signals | null;
        }
      | undefined;
    const stdout = createOutputCapture(maxOutputBytes);
    const stderr = createOutputCapture(maxOutputBytes);
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(input.command, {
      cwd,
      env,
      detached: useProcessGroup,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let forceKillTimeout: NodeJS.Timeout | undefined;
    const timeout =
      input.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killChildProcess(child, "SIGTERM", useProcessGroup);
            forceKillTimeout = setTimeout(() => {
              forceKillTimeout = undefined;
              forceKilled = killChildProcess(child, "SIGKILL", useProcessGroup);

              if (pendingClose !== undefined) {
                resolveFromClose(pendingClose.exitCode, pendingClose.signal);
              }
            }, killGraceMs);
            forceKillTimeout.unref();
          }, input.timeoutMs);

    timeout?.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.append(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.append(chunk);
    });

    child.once("error", (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (forceKillTimeout !== undefined) {
        clearTimeout(forceKillTimeout);
      }

      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      if (timedOut && forceKillTimeout !== undefined) {
        pendingClose = {
          exitCode,
          signal
        };
        return;
      }

      resolveFromClose(exitCode, signal);
    });

    function resolveFromClose(
      exitCode: number | null,
      signal: NodeJS.Signals | null
    ): void {
      if (forceKillTimeout !== undefined) {
        clearTimeout(forceKillTimeout);
      }

      resolveResult({
        command: redactText(input.command, redactionValues),
        cwd,
        exitCode,
        signal,
        durationMs: Math.round(performance.now() - startedAt),
        timedOut,
        forceKilled,
        stdout: redactText(stdout.contents(), redactionValues),
        stderr: redactText(stderr.contents(), redactionValues),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated
      });
    }
  });
}

function killChildProcess(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
  useProcessGroup: boolean
): boolean {
  if (useProcessGroup && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      return child.kill(signal);
    }
  }

  return child.kill(signal);
}

function createOutputCapture(maxBytes: number): {
  truncated: boolean;
  append: (chunk: Buffer) => void;
  contents: () => string;
} {
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;

  return {
    get truncated() {
      return truncated;
    },
    append(chunk) {
      const remainingBytes = maxBytes - capturedBytes;

      if (remainingBytes <= 0) {
        truncated = true;
        return;
      }

      if (chunk.byteLength > remainingBytes) {
        chunks.push(chunk.subarray(0, remainingBytes));
        capturedBytes += remainingBytes;
        truncated = true;
        return;
      }

      chunks.push(chunk);
      capturedBytes += chunk.byteLength;
    },
    contents() {
      return Buffer.concat(chunks).toString("utf8");
    }
  };
}

const SENSITIVE_ENV_KEY_PATTERN =
  /(?:secret|token|password|passwd|pwd|api[_-]?key|private[_-]?key|credential|auth)/i;

function collectRedactionValues(
  env: Record<string, string | undefined>,
  explicitValues: string[]
): string[] {
  const values = new Set<string>();

  for (const value of explicitValues) {
    if (value.length > 0) {
      values.add(value);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      value.length >= 8 &&
      SENSITIVE_ENV_KEY_PATTERN.test(key)
    ) {
      values.add(value);
    }
  }

  return Array.from(values).sort((left, right) => right.length - left.length);
}

function redactText(input: string, redactionValues: string[]): string {
  let output = input;

  for (const value of redactionValues) {
    output = output.split(value).join("[REDACTED]");
  }

  return output;
}
