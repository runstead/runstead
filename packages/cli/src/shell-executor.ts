import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

export interface ShellCommandInput {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ShellCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export function runShellCommand(input: ShellCommandInput): Promise<ShellCommandResult> {
  if (input.timeoutMs !== undefined && input.timeoutMs <= 0) {
    return Promise.reject(new Error("timeoutMs must be greater than 0"));
  }

  if (input.maxOutputBytes !== undefined && input.maxOutputBytes <= 0) {
    return Promise.reject(new Error("maxOutputBytes must be greater than 0"));
  }

  const cwd = resolve(input.cwd ?? process.cwd());
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = performance.now();

  return new Promise((resolveResult, reject) => {
    let timedOut = false;
    const stdout = createOutputCapture(maxOutputBytes);
    const stderr = createOutputCapture(maxOutputBytes);
    const child = spawn(input.command, {
      cwd,
      env: {
        ...process.env,
        ...input.env
      },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
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
        timedOut,
        stdout: stdout.contents(),
        stderr: stderr.contents(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated
      });
    });
  });
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
