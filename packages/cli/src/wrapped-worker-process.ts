import { spawn, spawnSync } from "node:child_process";

export const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_WORKER_MAX_OUTPUT_BYTES = 1024 * 1024 * 10;
export const DEFAULT_WORKER_STUCK_SILENCE_MS = 5 * 60_000;

export interface WorkerProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface WorkerProcessProgress {
  command: string;
  elapsedMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  capturedBytes: number;
  lastOutputElapsedMs: number;
  possiblyStuck: boolean;
  workspaceChangedFiles?: number;
  workspaceRecentFiles?: string[];
}

export type WorkerProcessRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
    progressIntervalMs?: number;
    stuckSilenceMs?: number;
    onProgress?: (progress: WorkerProcessProgress) => void;
  }
) => Promise<WorkerProcessResult>;

export async function runWorkerProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
    progressIntervalMs?: number;
    stuckSilenceMs?: number;
    onProgress?: (progress: WorkerProcessProgress) => void;
  }
): Promise<WorkerProcessResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_WORKER_MAX_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  const progressIntervalMs = options.progressIntervalMs ?? 30_000;
  const stuckSilenceMs = options.stuckSilenceMs ?? DEFAULT_WORKER_STUCK_SILENCE_MS;

  return await new Promise<WorkerProcessResult>((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let capturedBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    const startedAt = Date.now();
    let lastOutputAt = startedAt;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const emitProgress = (now: number, lastOutputElapsedMs: number): void => {
      const workspace = workerWorkspaceProgress(options.cwd);

      options.onProgress?.({
        command,
        elapsedMs: now - startedAt,
        stdoutBytes,
        stderrBytes,
        capturedBytes,
        lastOutputElapsedMs,
        possiblyStuck: lastOutputElapsedMs >= stuckSilenceMs,
        workspaceChangedFiles: workspace.changedFiles,
        workspaceRecentFiles: workspace.recentFiles
      });
    };
    const progress =
      options.onProgress === undefined
        ? undefined
        : setInterval(() => {
            const now = Date.now();

            emitProgress(now, now - lastOutputAt);
          }, progressIntervalMs);

    const resolveOnce = (result: WorkerProcessResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (progress !== undefined) {
        clearInterval(progress);
      }
      resolveResult(result);
    };

    const capture = (key: "stdout" | "stderr", chunk: Buffer): void => {
      const now = Date.now();
      const silentForMs = now - lastOutputAt;

      if (options.onProgress !== undefined && silentForMs >= stuckSilenceMs) {
        emitProgress(now, silentForMs);
      }

      lastOutputAt = now;

      if (capturedBytes >= maxOutputBytes) {
        outputTruncated = true;
        return;
      }

      const remainingBytes = maxOutputBytes - capturedBytes;
      const captured =
        chunk.byteLength > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk;

      if (captured.byteLength < chunk.byteLength) {
        outputTruncated = true;
      }

      capturedBytes += captured.byteLength;

      if (key === "stdout") {
        stdoutBytes += captured.byteLength;
        stdout += captured.toString("utf8");
      } else {
        stderrBytes += captured.byteLength;
        stderr += captured.toString("utf8");
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      capture("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      capture("stderr", chunk);
    });

    child.on("error", (error) => {
      resolveOnce({
        stdout,
        stderr: appendWorkerProcessNotice(stderr, error.message),
        exitCode: 1
      });
    });

    child.on("close", (code, signal) => {
      let finalStderr = stderr;

      if (outputTruncated) {
        finalStderr = appendWorkerProcessNotice(
          finalStderr,
          `worker output truncated at ${maxOutputBytes} bytes`
        );
      }

      if (timedOut) {
        finalStderr = appendWorkerProcessNotice(
          finalStderr,
          `worker timed out after ${timeoutMs} ms`
        );
      } else if (signal !== null) {
        finalStderr = appendWorkerProcessNotice(
          finalStderr,
          `worker exited from signal ${signal}`
        );
      }

      resolveOnce({
        stdout,
        stderr: finalStderr,
        exitCode: code ?? (timedOut ? 124 : 1)
      });
    });
  });
}

export function formatWorkerProcessProgress(progress: WorkerProcessProgress): string {
  return [
    "[runstead]",
    `wrapped worker still running: ${progress.command}`,
    `elapsed=${formatElapsed(progress.elapsedMs)}`,
    `last_output=${formatElapsed(progress.lastOutputElapsedMs)}`,
    `status=${progress.possiblyStuck ? "possibly_stuck" : "active"}`,
    `stdout=${progress.stdoutBytes}B`,
    `stderr=${progress.stderrBytes}B`,
    ...(progress.workspaceChangedFiles === undefined
      ? []
      : [`files=${progress.workspaceChangedFiles}`]),
    ...(progress.workspaceRecentFiles === undefined ||
    progress.workspaceRecentFiles.length === 0
      ? []
      : [`recent=${progress.workspaceRecentFiles.join(",")}`])
  ].join(" ");
}

export function appendWorkerProcessNotice(output: string, notice: string): string {
  return `${output}${output.length === 0 || output.endsWith("\n") ? "" : "\n"}[runstead] ${notice}\n`;
}

function workerWorkspaceProgress(cwd: string): {
  changedFiles: number;
  recentFiles: string[];
} {
  const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd,
    encoding: "utf8",
    timeout: 2_000,
    maxBuffer: 1024 * 1024
  });

  if (result.status !== 0) {
    return {
      changedFiles: 0,
      recentFiles: []
    };
  }

  const files = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
    .filter((file) => file !== ".runstead" && !file.startsWith(".runstead/"));

  return {
    changedFiles: files.length,
    recentFiles: files.slice(0, 3)
  };
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes === 0 ? `${seconds}s` : `${minutes}m${seconds}s`;
}
